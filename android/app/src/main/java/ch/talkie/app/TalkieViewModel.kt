package ch.talkie.app

import android.app.Application
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ch.talkie.app.audio.WavRecorder
import ch.talkie.app.data.Persistence
import ch.talkie.app.data.RecentChannel
import ch.talkie.app.data.TalkieSettings
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.participant.RemoteParticipant
import io.livekit.android.room.track.RemoteAudioTrack
import io.livekit.android.room.track.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

data class ParticipantUi(
    val identity: String,
    val isLocal: Boolean,
    val isSpeaking: Boolean,
    val volume: Float,
    val muted: Boolean,
)

data class ChatMessage(
    val id: String,
    val from: String,
    val text: String,
    val timestamp: Long,
)

data class ReplayClip(
    val id: String,
    val from: String,
    val timestamp: Long,
    val durationMs: Long,
    val filePath: String,
)

enum class TalkieTab { People, Chat, Replays }

data class TalkieState(
    val name: String = "",
    val channel: String = "general",
    val pin: String = "",
    val status: Status = Status.Idle,
    val transmitting: Boolean = false,
    val participants: List<ParticipantUi> = emptyList(),
    val error: String? = null,
    val micPermissionGranted: Boolean = false,
    val tab: TalkieTab = TalkieTab.People,
    val messages: List<ChatMessage> = emptyList(),
    val unreadChat: Int = 0,
    val unreadReplays: Int = 0,
    val draft: String = "",
    val settings: TalkieSettings = TalkieSettings(),
    val recents: List<RecentChannel> = emptyList(),
    val inSettings: Boolean = false,
    val replays: List<ReplayClip> = emptyList(),
    val playingReplayId: String? = null,
) {
    val isPrivate: Boolean get() = pin.isNotBlank()

    enum class Status { Idle, Connecting, Connected, Disconnected }
}

class TalkieViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(TalkieState())
    val state: StateFlow<TalkieState> = _state.asStateFlow()

    private var room: Room? = null
    private val remoteTracks = mutableMapOf<String, RemoteAudioTrack>()
    private val mixer = mutableMapOf<String, MixerEntry>()
    private val recorders = mutableMapOf<String, WavRecorder>()
    private val replayCutoffMs = 30_000L
    private val maxReplays = 20
    private var toneGenerator: ToneGenerator? = null
    private var mediaPlayer: MediaPlayer? = null

    init {
        val ctx = app.applicationContext
        _state.update {
            it.copy(
                name = Persistence.loadLastName(ctx),
                settings = Persistence.loadSettings(ctx),
                recents = Persistence.loadRecents(ctx),
            )
        }
    }

    fun setName(value: String) = _state.update { it.copy(name = value) }
    fun setChannel(value: String) = _state.update { it.copy(channel = value) }
    fun setPin(value: String) = _state.update { it.copy(pin = value) }
    fun setDraft(value: String) = _state.update { it.copy(draft = value) }

    fun selectTab(tab: TalkieTab) {
        _state.update {
            it.copy(
                tab = tab,
                unreadChat = if (tab == TalkieTab.Chat) 0 else it.unreadChat,
                unreadReplays = if (tab == TalkieTab.Replays) 0 else it.unreadReplays,
            )
        }
    }

    fun openSettings() = _state.update { it.copy(inSettings = true) }
    fun closeSettings() = _state.update { it.copy(inSettings = false) }

    fun updateSettings(s: TalkieSettings) {
        Persistence.saveSettings(getApplication(), s)
        _state.update { it.copy(settings = s) }
        // re-apply output volume scaling
        remoteTracks.forEach { (id, track) ->
            val entry = mixer[id] ?: MixerEntry()
            applyVolume(track, entry, s.outputVolume)
        }
    }

    fun joinRecent(recent: RecentChannel, pinIfPrivate: String) {
        _state.update {
            it.copy(
                channel = recent.name,
                pin = if (recent.isPrivate) pinIfPrivate else "",
            )
        }
        connect()
    }

    fun forgetRecent(name: String) {
        Persistence.forgetChannel(getApplication(), name)
        _state.update { it.copy(recents = Persistence.loadRecents(getApplication())) }
    }

    fun onMicPermissionResult(granted: Boolean) {
        _state.update { it.copy(micPermissionGranted = granted) }
    }

    fun connect() {
        val s = _state.value
        if (s.name.isBlank() || s.channel.isBlank()) return
        if (!s.micPermissionGranted) {
            _state.update { it.copy(error = "Microphone permission is required") }
            return
        }
        Persistence.saveLastName(getApplication(), s.name.trim())

        _state.update { it.copy(status = TalkieState.Status.Connecting, error = null) }

        viewModelScope.launch {
            try {
                val (wsUrl, token) = fetchToken(s.name, s.channel, s.pin)
                val r = LiveKit.create(getApplication())
                room = r

                viewModelScope.launch {
                    r.events.collect { event ->
                        handleRoomEvent(r, event)
                    }
                }

                r.connect(wsUrl, token)
                r.localParticipant.setMicrophoneEnabled(false)

                r.remoteParticipants.values.forEach(::wireParticipant)

                Persistence.rememberChannel(getApplication(), s.channel, s.isPrivate)
                _state.update {
                    it.copy(
                        status = TalkieState.Status.Connected,
                        recents = Persistence.loadRecents(getApplication()),
                    )
                }
                refreshParticipants(r)
                startPttService()
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        status = TalkieState.Status.Disconnected,
                        error = e.message ?: "Failed to connect",
                    )
                }
            }
        }
    }

    private fun handleRoomEvent(r: Room, event: RoomEvent) {
        when (event) {
            is RoomEvent.ParticipantConnected -> {
                wireParticipant(event.participant as RemoteParticipant)
                refreshParticipants(r)
            }
            is RoomEvent.ParticipantDisconnected -> {
                val id = event.participant.identity?.value
                if (id != null) {
                    finishReplayRecording(id)
                    mixer.remove(id)
                    remoteTracks.remove(id)
                }
                refreshParticipants(r)
            }
            is RoomEvent.TrackSubscribed -> {
                val track = event.track
                if (track is RemoteAudioTrack) {
                    val id = event.participant.identity?.value ?: return
                    remoteTracks[id] = track
                    val entry = mixer.getOrPut(id) { MixerEntry() }
                    applyVolume(track, entry, _state.value.settings.outputVolume)
                }
            }
            is RoomEvent.TrackUnsubscribed -> {
                val id = event.participant.identity?.value ?: return
                if (event.track is RemoteAudioTrack) {
                    finishReplayRecording(id)
                    remoteTracks.remove(id)
                }
            }
            is RoomEvent.ActiveSpeakersChanged -> {
                refreshParticipants(r)
            }
            is RoomEvent.TrackMuted, is RoomEvent.TrackUnmuted -> {
                refreshParticipants(r)
            }
            is RoomEvent.DataReceived -> {
                onData(event.data, event.participant)
            }
            else -> Unit
        }
    }

    private fun wireParticipant(p: RemoteParticipant) {
        viewModelScope.launch {
            p.events.collect { event ->
                if (event is io.livekit.android.events.ParticipantEvent.SpeakingChanged) {
                    onSpeakingChanged(
                        p.identity?.value ?: return@collect,
                        event.isSpeaking,
                    )
                }
            }
        }
    }

    private fun onSpeakingChanged(identity: String, speaking: Boolean) {
        val r = room ?: return
        if (speaking) {
            val s = _state.value.settings
            if (s.beepOnIncoming) playBeep()
            if (s.vibrateOnIncoming) vibrate()
            startReplayRecording(identity)
        } else {
            finishReplayRecording(identity)
        }
        refreshParticipants(r)
    }

    private fun startReplayRecording(identity: String) {
        if (recorders.containsKey(identity)) return
        val track = remoteTracks[identity] ?: return
        val dir = File(getApplication<Application>().cacheDir, "replays").apply {
            if (!exists()) mkdirs()
        }
        val file = File(dir, "${identity}-${System.currentTimeMillis()}.wav")
        val recorder = try {
            WavRecorder(file)
        } catch (_: Exception) {
            return
        }
        try {
            track.rtcTrack.addSink(recorder)
        } catch (_: Exception) {
            recorder.cancel()
            return
        }
        recorders[identity] = recorder
        // safety: stop after replayCutoffMs even if still speaking
        viewModelScope.launch {
            kotlinx.coroutines.delay(replayCutoffMs)
            if (recorders[identity] === recorder) {
                finishReplayRecording(identity)
            }
        }
    }

    private fun finishReplayRecording(identity: String) {
        val recorder = recorders.remove(identity) ?: return
        val track = remoteTracks[identity]
        try {
            track?.rtcTrack?.removeSink(recorder)
        } catch (_: Exception) {}
        val durationMs = recorder.finish()
        if (durationMs < 300) {
            try { recorder.file.delete() } catch (_: Exception) {}
            return
        }
        val clip = ReplayClip(
            id = UUID.randomUUID().toString(),
            from = identity,
            timestamp = recorder.startedAt,
            durationMs = durationMs,
            filePath = recorder.file.absolutePath,
        )
        _state.update {
            val next = (listOf(clip) + it.replays).take(maxReplays)
            val dropped = (listOf(clip) + it.replays).drop(maxReplays)
            dropped.forEach { d -> try { File(d.filePath).delete() } catch (_: Exception) {} }
            it.copy(
                replays = next,
                unreadReplays = if (it.tab == TalkieTab.Replays) 0 else it.unreadReplays + 1,
            )
        }
    }

    fun playReplay(clip: ReplayClip) {
        val current = _state.value.playingReplayId
        // tapping the currently playing clip stops it
        if (current == clip.id) {
            stopPlayback()
            return
        }
        stopPlayback()
        val mp = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            setOnCompletionListener {
                _state.update { it.copy(playingReplayId = null) }
                release()
                if (mediaPlayer === this) mediaPlayer = null
            }
            setOnErrorListener { _, _, _ ->
                _state.update { it.copy(playingReplayId = null) }
                true
            }
            try {
                setDataSource(clip.filePath)
                prepare()
                start()
            } catch (_: Exception) {
                _state.update { it.copy(playingReplayId = null) }
                release()
                return
            }
        }
        mediaPlayer = mp
        _state.update { it.copy(playingReplayId = clip.id) }
    }

    fun stopPlayback() {
        try {
            mediaPlayer?.takeIf { it.isPlaying }?.stop()
        } catch (_: Exception) {}
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null
        if (_state.value.playingReplayId != null) {
            _state.update { it.copy(playingReplayId = null) }
        }
    }

    fun clearReplays() {
        stopPlayback()
        _state.value.replays.forEach { c ->
            try { File(c.filePath).delete() } catch (_: Exception) {}
        }
        _state.update { it.copy(replays = emptyList(), unreadReplays = 0) }
    }

    private fun onData(payload: ByteArray, participant: Participant?) {
        try {
            val text = String(payload, Charsets.UTF_8)
            val obj = JSONObject(text)
            if (obj.optString("type") == "chat") {
                val from = participant?.identity?.value ?: obj.optString("from", "(unknown)")
                val msg = ChatMessage(
                    id = UUID.randomUUID().toString(),
                    from = from,
                    text = obj.optString("text"),
                    timestamp = obj.optLong("ts", System.currentTimeMillis()),
                )
                _state.update {
                    it.copy(
                        messages = it.messages + msg,
                        unreadChat = if (it.tab == TalkieTab.Chat) 0 else it.unreadChat + 1,
                    )
                }
            }
        } catch (_: Exception) {}
    }

    fun sendMessage() {
        val text = _state.value.draft.trim()
        if (text.isEmpty()) return
        val r = room ?: return
        if (_state.value.status != TalkieState.Status.Connected) return
        viewModelScope.launch {
            val payload = JSONObject()
                .put("type", "chat")
                .put("text", text)
                .put("from", _state.value.name)
                .put("ts", System.currentTimeMillis())
                .toString()
                .toByteArray(Charsets.UTF_8)
            try {
                r.localParticipant.publishData(payload)
                _state.update {
                    it.copy(
                        messages = it.messages + ChatMessage(
                            id = UUID.randomUUID().toString(),
                            from = it.name,
                            text = text,
                            timestamp = System.currentTimeMillis(),
                        ),
                        draft = "",
                    )
                }
            } catch (_: Exception) {}
        }
    }

    fun setParticipantVolume(identity: String, volume: Float) {
        val entry = mixer.getOrPut(identity) { MixerEntry() }.copy(volume = volume)
        mixer[identity] = entry
        remoteTracks[identity]?.let {
            applyVolume(it, entry, _state.value.settings.outputVolume)
        }
        val r = room ?: return
        refreshParticipants(r)
    }

    fun toggleMute(identity: String) {
        val entry = mixer.getOrPut(identity) { MixerEntry() }
        val next = entry.copy(muted = !entry.muted)
        mixer[identity] = next
        remoteTracks[identity]?.let {
            applyVolume(it, next, _state.value.settings.outputVolume)
        }
        val r = room ?: return
        refreshParticipants(r)
    }

    fun startTalking() {
        val r = room ?: return
        if (_state.value.status != TalkieState.Status.Connected) return
        viewModelScope.launch {
            r.localParticipant.setMicrophoneEnabled(true)
            _state.update { it.copy(transmitting = true) }
        }
    }

    fun stopTalking() {
        val r = room ?: return
        viewModelScope.launch {
            r.localParticipant.setMicrophoneEnabled(false)
            _state.update { it.copy(transmitting = false) }
        }
    }

    fun disconnect() {
        stopPlayback()
        recorders.values.forEach { it.cancel() }
        recorders.clear()
        _state.value.replays.forEach { c ->
            try { File(c.filePath).delete() } catch (_: Exception) {}
        }
        room?.disconnect()
        room = null
        remoteTracks.clear()
        mixer.clear()
        stopPttService()
        _state.update {
            it.copy(
                status = TalkieState.Status.Disconnected,
                participants = emptyList(),
                messages = emptyList(),
                unreadChat = 0,
                unreadReplays = 0,
                transmitting = false,
                pin = "",
                replays = emptyList(),
                playingReplayId = null,
            )
        }
    }

    private fun refreshParticipants(r: Room) {
        val list = mutableListOf<ParticipantUi>()
        val localId = r.localParticipant.identity?.value ?: _state.value.name
        list += ParticipantUi(
            identity = localId,
            isLocal = true,
            isSpeaking = r.localParticipant.isSpeaking,
            volume = 1f,
            muted = false,
        )
        r.remoteParticipants.values.forEach { p ->
            val id = p.identity?.value ?: return@forEach
            val entry = mixer[id] ?: MixerEntry()
            list += ParticipantUi(
                identity = id,
                isLocal = false,
                isSpeaking = p.isSpeaking,
                volume = entry.volume,
                muted = entry.muted,
            )
        }
        _state.update { it.copy(participants = list) }
    }

    private fun applyVolume(
        track: RemoteAudioTrack,
        entry: MixerEntry,
        outputVolume: Float,
    ) {
        val v = if (entry.muted) 0f else (entry.volume * outputVolume).coerceIn(0f, 1f)
        try {
            track.setVolume(v.toDouble())
        } catch (_: Exception) {}
    }

    private fun playBeep() {
        try {
            if (toneGenerator == null) {
                toneGenerator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60)
            }
            toneGenerator?.startTone(ToneGenerator.TONE_PROP_BEEP, 80)
        } catch (_: Exception) {}
    }

    private fun vibrate() {
        try {
            val ctx = getApplication<Application>()
            val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val mgr = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                mgr.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(40)
            }
        } catch (_: Exception) {}
    }

    private suspend fun fetchToken(
        identity: String,
        channel: String,
        pin: String,
    ): Pair<String, String> =
        withContext(Dispatchers.IO) {
            val base = BuildConfig.TOKEN_BASE_URL.trimEnd('/')
            val url = URL("$base/api/token")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            val requestBody = JSONObject().apply {
                put("identity", identity)
                put("room", channel)
                if (pin.isNotBlank()) put("pin", pin)
            }.toString()
            try {
                conn.outputStream.use { it.write(requestBody.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val resp = (if (code in 200..299) conn.inputStream else conn.errorStream)
                    .bufferedReader().use { it.readText() }
                if (code !in 200..299) throw IOException("token request failed: $code $resp")
                val json = JSONObject(resp)
                json.getString("wsUrl") to json.getString("token")
            } finally {
                conn.disconnect()
            }
        }

    private fun startPttService() {
        val ctx = getApplication<Application>()
        val intent = Intent(ctx, PttForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
    }

    private fun stopPttService() {
        val ctx = getApplication<Application>()
        ctx.stopService(Intent(ctx, PttForegroundService::class.java))
    }

    override fun onCleared() {
        stopPlayback()
        recorders.values.forEach { it.cancel() }
        recorders.clear()
        _state.value.replays.forEach { c ->
            try { File(c.filePath).delete() } catch (_: Exception) {}
        }
        room?.disconnect()
        toneGenerator?.release()
        stopPttService()
        super.onCleared()
    }

    private data class MixerEntry(val volume: Float = 1f, val muted: Boolean = false)
}

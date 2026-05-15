package ch.talkie.app

import android.app.Application
import android.content.Intent
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class ParticipantUi(
    val identity: String,
    val isLocal: Boolean,
    val isSpeaking: Boolean,
)

data class TalkieState(
    val name: String = "",
    val channel: String = "general",
    val pin: String = "",
    val status: Status = Status.Idle,
    val transmitting: Boolean = false,
    val participants: List<ParticipantUi> = emptyList(),
    val error: String? = null,
    val micPermissionGranted: Boolean = false,
) {
    val isPrivate: Boolean get() = pin.isNotBlank()

    enum class Status { Idle, Connecting, Connected, Disconnected }
}

class TalkieViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(TalkieState())
    val state: StateFlow<TalkieState> = _state.asStateFlow()

    private var room: Room? = null

    fun setName(value: String) = _state.update { it.copy(name = value) }
    fun setChannel(value: String) = _state.update { it.copy(channel = value) }
    fun setPin(value: String) = _state.update { it.copy(pin = value) }

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

        _state.update { it.copy(status = TalkieState.Status.Connecting, error = null) }

        viewModelScope.launch {
            try {
                val (wsUrl, token) = fetchToken(s.name, s.channel, s.pin)
                val r = LiveKit.create(getApplication())
                room = r

                viewModelScope.launch {
                    r.events.collect { event ->
                        when (event) {
                            is RoomEvent.ParticipantConnected,
                            is RoomEvent.ParticipantDisconnected,
                            is RoomEvent.ActiveSpeakersChanged,
                            is RoomEvent.TrackMuted,
                            is RoomEvent.TrackUnmuted -> refreshParticipants(r)
                            else -> Unit
                        }
                    }
                }

                r.connect(wsUrl, token)
                r.localParticipant.setMicrophoneEnabled(false)

                startPttService()
                _state.update { it.copy(status = TalkieState.Status.Connected) }
                refreshParticipants(r)
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
        room?.disconnect()
        room = null
        stopPttService()
        _state.update {
            it.copy(
                status = TalkieState.Status.Disconnected,
                participants = emptyList(),
                transmitting = false,
            )
        }
    }

    private fun refreshParticipants(r: Room) {
        val list = mutableListOf<ParticipantUi>()
        list += ParticipantUi(
            identity = r.localParticipant.identity?.value ?: _state.value.name,
            isLocal = true,
            isSpeaking = r.localParticipant.isSpeaking,
        )
        r.remoteParticipants.values.forEach { p: Participant ->
            list += ParticipantUi(
                identity = p.identity?.value ?: "(unknown)",
                isLocal = false,
                isSpeaking = p.isSpeaking,
            )
        }
        _state.update { it.copy(participants = list) }
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
        room?.disconnect()
        stopPttService()
        super.onCleared()
    }
}

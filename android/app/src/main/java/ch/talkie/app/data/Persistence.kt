package ch.talkie.app.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

private const val PREFS = "talkie_prefs"
private const val KEY_RECENTS = "recent_channels"
private const val KEY_SETTINGS = "settings"
private const val KEY_LAST_NAME = "last_name"
private const val MAX_RECENTS = 8

data class RecentChannel(
    val name: String,
    val lastJoinedAt: Long,
    val isPrivate: Boolean,
)

data class TalkieSettings(
    val outputVolume: Float = 1f,
    val beepOnIncoming: Boolean = true,
    val vibrateOnIncoming: Boolean = true,
)

object Persistence {

    fun loadRecents(ctx: Context): List<RecentChannel> {
        val raw = ctx.prefs().getString(KEY_RECENTS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val name = o.optString("name").takeIf { it.isNotBlank() }
                    ?: return@mapNotNull null
                RecentChannel(
                    name = name,
                    lastJoinedAt = o.optLong("ts", 0L),
                    isPrivate = o.optBoolean("private", false),
                )
            }.sortedByDescending { it.lastJoinedAt }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun rememberChannel(ctx: Context, name: String, isPrivate: Boolean) {
        val current = loadRecents(ctx).filter { it.name != name }
        val next = listOf(
            RecentChannel(name, System.currentTimeMillis(), isPrivate),
        ) + current
        saveRecents(ctx, next.take(MAX_RECENTS))
    }

    fun forgetChannel(ctx: Context, name: String) {
        val remaining = loadRecents(ctx).filter { it.name != name }
        saveRecents(ctx, remaining)
    }

    private fun saveRecents(ctx: Context, recents: List<RecentChannel>) {
        val arr = JSONArray()
        recents.forEach { r ->
            arr.put(
                JSONObject()
                    .put("name", r.name)
                    .put("ts", r.lastJoinedAt)
                    .put("private", r.isPrivate),
            )
        }
        ctx.prefs().edit().putString(KEY_RECENTS, arr.toString()).apply()
    }

    fun loadSettings(ctx: Context): TalkieSettings {
        val raw = ctx.prefs().getString(KEY_SETTINGS, null) ?: return TalkieSettings()
        return try {
            val o = JSONObject(raw)
            TalkieSettings(
                outputVolume = o.optDouble("outputVolume", 1.0).toFloat(),
                beepOnIncoming = o.optBoolean("beepOnIncoming", true),
                vibrateOnIncoming = o.optBoolean("vibrateOnIncoming", true),
            )
        } catch (_: Exception) {
            TalkieSettings()
        }
    }

    fun saveSettings(ctx: Context, s: TalkieSettings) {
        val o = JSONObject()
            .put("outputVolume", s.outputVolume.toDouble())
            .put("beepOnIncoming", s.beepOnIncoming)
            .put("vibrateOnIncoming", s.vibrateOnIncoming)
        ctx.prefs().edit().putString(KEY_SETTINGS, o.toString()).apply()
    }

    fun loadLastName(ctx: Context): String =
        ctx.prefs().getString(KEY_LAST_NAME, null).orEmpty()

    fun saveLastName(ctx: Context, name: String) {
        ctx.prefs().edit().putString(KEY_LAST_NAME, name).apply()
    }

    private fun Context.prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

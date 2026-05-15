package ch.talkie.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.talkie.app.ParticipantUi
import ch.talkie.app.TalkieState
import ch.talkie.app.TalkieViewModel

private val ColorScheme = darkColorScheme(
    primary = Color(0xFF34D399),
    onPrimary = Color(0xFF052E1A),
    background = Color(0xFF0A0A0A),
    onBackground = Color(0xFFF5F5F5),
    surface = Color(0xFF171717),
    onSurface = Color(0xFFF5F5F5),
)

@Composable
fun TalkieApp(viewModel: TalkieViewModel) {
    val state by viewModel.state.collectAsState()
    MaterialTheme(colorScheme = ColorScheme) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
        ) {
            when (state.status) {
                TalkieState.Status.Idle,
                TalkieState.Status.Disconnected -> JoinScreen(state, viewModel)
                TalkieState.Status.Connecting,
                TalkieState.Status.Connected -> ChannelScreen(state, viewModel)
            }
        }
    }
}

@Composable
private fun JoinScreen(state: TalkieState, viewModel: TalkieViewModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "Talkie",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Hold to talk. Release to listen.",
            color = Color(0xFFA3A3A3),
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = state.name,
            onValueChange = viewModel::setName,
            label = { Text("Your name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = state.channel,
            onValueChange = viewModel::setChannel,
            label = { Text("Channel") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        if (state.error != null) {
            Spacer(Modifier.height(16.dp))
            Text(state.error, color = Color(0xFFFCA5A5), fontSize = 14.sp)
        }

        Spacer(Modifier.height(32.dp))
        Button(
            onClick = { viewModel.connect() },
            enabled = state.name.isNotBlank() &&
                state.channel.isNotBlank() &&
                state.micPermissionGranted,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Text("Connect", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        if (!state.micPermissionGranted) {
            Spacer(Modifier.height(12.dp))
            Text(
                "Microphone permission required to connect.",
                color = Color(0xFFFCD34D),
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun ChannelScreen(state: TalkieState, viewModel: TalkieViewModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Channel",
                    color = Color(0xFF737373),
                    fontSize = 12.sp,
                )
                Text(
                    "#${state.channel}",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            StatusBadge(state.status)
            Spacer(Modifier.size(16.dp))
            Text(
                "Leave",
                color = Color(0xFF737373),
                fontSize = 14.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .pointerInput(Unit) {
                        detectTapGestures(onTap = { viewModel.disconnect() })
                    }
                    .padding(8.dp),
            )
        }

        if (state.error != null) {
            Text(
                state.error,
                color = Color(0xFFFCA5A5),
                fontSize = 13.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0x331A0000))
                    .padding(16.dp),
            )
        }

        Text(
            "In channel (${state.participants.size})",
            color = Color(0xFF737373),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
        )

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        ) {
            items(state.participants, key = { it.identity }) { p ->
                ParticipantRow(p)
            }
        }

        TalkButton(
            connected = state.status == TalkieState.Status.Connected,
            transmitting = state.transmitting,
            onStart = viewModel::startTalking,
            onStop = viewModel::stopTalking,
        )
    }
}

@Composable
private fun ParticipantRow(p: ParticipantUi) {
    val bg = if (p.isSpeaking) Color(0xFF052E1A) else Color.Transparent
    val borderColor = if (p.isSpeaking) MaterialTheme.colorScheme.primary else Color.Transparent
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .border(1.dp, borderColor, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(
                    if (p.isSpeaking) MaterialTheme.colorScheme.primary else Color(0xFF525252),
                ),
        )
        Spacer(Modifier.size(12.dp))
        Text(
            p.identity,
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 16.sp,
            fontWeight = FontWeight.Medium,
        )
        if (p.isLocal) {
            Spacer(Modifier.size(8.dp))
            Text("(you)", color = Color(0xFF737373), fontSize = 12.sp)
        }
        if (p.isSpeaking) {
            Spacer(Modifier.weight(1f))
            Text("speaking", color = MaterialTheme.colorScheme.primary, fontSize = 12.sp)
        }
    }
}

@Composable
private fun StatusBadge(status: TalkieState.Status) {
    val (color, label) = when (status) {
        TalkieState.Status.Connected -> MaterialTheme.colorScheme.primary to "live"
        TalkieState.Status.Connecting -> Color(0xFFFBBF24) to "connecting"
        else -> Color(0xFF737373) to "offline"
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(color),
        )
        Spacer(Modifier.size(6.dp))
        Text(label, color = Color(0xFFA3A3A3), fontSize = 12.sp)
    }
}

@Composable
private fun TalkButton(
    connected: Boolean,
    transmitting: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
) {
    val bg = when {
        !connected -> Color(0xFF404040)
        transmitting -> Color(0xFFEF4444)
        else -> MaterialTheme.colorScheme.primary
    }
    val label = when {
        !connected -> "…"
        transmitting -> "ON AIR"
        else -> "TALK"
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Hold to talk",
            color = Color(0xFF737373),
            fontSize = 12.sp,
        )
        Spacer(Modifier.height(12.dp))
        Box(
            modifier = Modifier
                .size(180.dp)
                .clip(CircleShape)
                .background(bg)
                .pointerInput(connected) {
                    if (!connected) return@pointerInput
                    detectTapGestures(
                        onPress = {
                            onStart()
                            try {
                                tryAwaitRelease()
                            } finally {
                                onStop()
                            }
                        },
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label,
                color = Color(0xFF052E1A),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

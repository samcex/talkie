package ch.talkie.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.talkie.app.ChatMessage
import ch.talkie.app.ParticipantUi
import ch.talkie.app.ReplayClip
import ch.talkie.app.TalkieState
import ch.talkie.app.TalkieTab
import ch.talkie.app.TalkieViewModel
import ch.talkie.app.data.RecentChannel
import ch.talkie.app.data.TalkieSettings
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

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
            when {
                state.inSettings -> SettingsScreen(state, viewModel)
                state.status == TalkieState.Status.Idle ||
                    state.status == TalkieState.Status.Disconnected ->
                    JoinScreen(state, viewModel)
                else -> ChannelScreen(state, viewModel)
            }
        }
    }
}

@Composable
private fun JoinScreen(state: TalkieState, viewModel: TalkieViewModel) {
    var pinPromptFor by remember { mutableStateOf<RecentChannel?>(null) }
    var pinPromptValue by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Talkie",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            TextLink("Settings", onClick = viewModel::openSettings)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "Push-to-talk for teams",
            color = Color(0xFFA3A3A3),
            fontSize = 13.sp,
        )

        Spacer(Modifier.height(24.dp))

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(Color(0xFF171717))
                .border(1.dp, Color(0xFF262626), RoundedCornerShape(20.dp))
                .padding(20.dp),
        ) {
            OutlinedTextField(
                value = state.name,
                onValueChange = viewModel::setName,
                label = { Text("Your name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = state.channel,
                onValueChange = viewModel::setChannel,
                label = { Text("Channel") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = state.pin,
                onValueChange = viewModel::setPin,
                label = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("PIN")
                        Spacer(Modifier.size(6.dp))
                        Text(
                            "(optional)",
                            color = Color(0xFF737373),
                            fontSize = 12.sp,
                        )
                        if (state.isPrivate) {
                            Spacer(Modifier.size(6.dp))
                            Icon(
                                Icons.Filled.Lock,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(12.dp),
                            )
                        }
                    }
                },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Set a PIN to make this channel private. Only people with the same PIN join the same room.",
                color = Color(0xFF737373),
                fontSize = 11.sp,
            )

            if (state.error != null) {
                Spacer(Modifier.height(12.dp))
                Text(state.error, color = Color(0xFFFCA5A5), fontSize = 13.sp)
            }

            Spacer(Modifier.height(20.dp))
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
                    .height(52.dp),
            ) {
                Text(
                    if (state.isPrivate) "Join private channel" else "Connect",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (!state.micPermissionGranted) {
                Spacer(Modifier.height(10.dp))
                Text(
                    "Microphone permission required to connect.",
                    color = Color(0xFFFCD34D),
                    fontSize = 12.sp,
                )
            }
        }

        if (state.recents.isNotEmpty()) {
            Spacer(Modifier.height(20.dp))
            Text(
                "Recent channels",
                color = Color(0xFF737373),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
            )
            state.recents.forEach { r ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF171717))
                        .border(1.dp, Color(0xFF262626), RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .weight(1f)
                            .pointerInput(state.name) {
                                detectTapGestures(onTap = {
                                    if (state.name.isBlank()) return@detectTapGestures
                                    if (r.isPrivate) {
                                        pinPromptFor = r
                                        pinPromptValue = ""
                                    } else {
                                        viewModel.joinRecent(r, "")
                                    }
                                })
                            },
                    ) {
                        if (r.isPrivate) {
                            Icon(
                                Icons.Filled.Lock,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(12.dp),
                            )
                            Spacer(Modifier.size(6.dp))
                        }
                        Text(
                            "#${r.name}",
                            color = if (state.name.isBlank())
                                Color(0xFF525252)
                            else MaterialTheme.colorScheme.onBackground,
                            fontSize = 14.sp,
                        )
                    }
                    Text(
                        relativeTime(r.lastJoinedAt),
                        color = Color(0xFF525252),
                        fontSize = 11.sp,
                    )
                    Spacer(Modifier.size(10.dp))
                    Text(
                        "✕",
                        color = Color(0xFF525252),
                        fontSize = 14.sp,
                        modifier = Modifier
                            .pointerInput(r.name) {
                                detectTapGestures(onTap = {
                                    viewModel.forgetRecent(r.name)
                                })
                            }
                            .padding(4.dp),
                    )
                }
            }
        }

        Spacer(Modifier.height(20.dp))
    }

    if (pinPromptFor != null) {
        PinPromptDialog(
            channel = pinPromptFor!!,
            value = pinPromptValue,
            onValue = { pinPromptValue = it },
            onCancel = { pinPromptFor = null },
            onConfirm = {
                val r = pinPromptFor!!
                pinPromptFor = null
                viewModel.joinRecent(r, pinPromptValue)
            },
        )
    }
}

@Composable
private fun PinPromptDialog(
    channel: RecentChannel,
    value: String,
    onValue: (String) -> Unit,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xCC000000))
            .pointerInput(Unit) { detectTapGestures { } },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .padding(24.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Color(0xFF171717))
                .border(1.dp, Color(0xFF262626), RoundedCornerShape(20.dp))
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.Lock,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    "#${channel.name}",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "This channel is private. Enter the PIN to join.",
                color = Color(0xFFA3A3A3),
                fontSize = 12.sp,
            )
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = value,
                onValueChange = onValue,
                label = { Text("PIN") },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(16.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = onCancel,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF262626),
                        contentColor = Color(0xFFE5E5E5),
                    ),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .weight(1f)
                        .height(44.dp),
                ) {
                    Text("Cancel", fontSize = 14.sp)
                }
                Spacer(Modifier.size(10.dp))
                Button(
                    onClick = onConfirm,
                    enabled = value.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .weight(1f)
                        .height(44.dp),
                ) {
                    Text("Join", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
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
        ChannelHeader(state, viewModel)

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

        TalkieTabs(state, viewModel)

        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when (state.tab) {
                TalkieTab.People -> PeoplePanel(state.participants, viewModel)
                TalkieTab.Chat -> ChatPanel(state, viewModel)
                TalkieTab.Replays -> ReplaysPanel(state, viewModel)
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
private fun ChannelHeader(state: TalkieState, viewModel: TalkieViewModel) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                if (state.isPrivate) "Channel · private" else "Channel",
                color = Color(0xFF737373),
                fontSize = 11.sp,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (state.isPrivate) {
                    Icon(
                        Icons.Filled.Lock,
                        contentDescription = "Private",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(14.dp),
                    )
                    Spacer(Modifier.size(6.dp))
                }
                Text(
                    "#${state.channel}",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    overflow = TextOverflow.Ellipsis,
                    maxLines = 1,
                )
            }
        }
        StatusBadge(state.status)
        Spacer(Modifier.size(14.dp))
        TextLink("Settings", viewModel::openSettings)
        Spacer(Modifier.size(14.dp))
        TextLink("Leave", viewModel::disconnect)
    }
}

@Composable
private fun TalkieTabs(state: TalkieState, viewModel: TalkieViewModel) {
    val selected = when (state.tab) {
        TalkieTab.People -> 0
        TalkieTab.Chat -> 1
        TalkieTab.Replays -> 2
    }
    TabRow(
        selectedTabIndex = selected,
        containerColor = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.primary,
        indicator = { positions ->
            TabRowDefaults.SecondaryIndicator(
                modifier = Modifier.tabIndicatorOffset(positions[selected]),
                color = MaterialTheme.colorScheme.primary,
            )
        },
    ) {
        Tab(
            selected = selected == 0,
            onClick = { viewModel.selectTab(TalkieTab.People) },
            text = {
                Text(
                    "People (${state.participants.size})",
                    fontSize = 12.sp,
                    color = if (selected == 0) MaterialTheme.colorScheme.primary
                    else Color(0xFFA3A3A3),
                )
            },
        )
        Tab(
            selected = selected == 1,
            onClick = { viewModel.selectTab(TalkieTab.Chat) },
            text = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Chat",
                        fontSize = 12.sp,
                        color = if (selected == 1) MaterialTheme.colorScheme.primary
                        else Color(0xFFA3A3A3),
                    )
                    if (state.unreadChat > 0) {
                        Spacer(Modifier.size(4.dp))
                        Badge(state.unreadChat)
                    }
                }
            },
        )
        Tab(
            selected = selected == 2,
            onClick = { viewModel.selectTab(TalkieTab.Replays) },
            text = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Replays",
                        fontSize = 12.sp,
                        color = if (selected == 2) MaterialTheme.colorScheme.primary
                        else Color(0xFFA3A3A3),
                    )
                    if (state.unreadReplays > 0) {
                        Spacer(Modifier.size(4.dp))
                        Badge(state.unreadReplays)
                    }
                }
            },
        )
    }
}

@Composable
private fun Badge(count: Int) {
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary)
            .padding(horizontal = 6.dp, vertical = 1.dp),
    ) {
        Text(
            "$count",
            color = MaterialTheme.colorScheme.onPrimary,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun PeoplePanel(
    participants: List<ParticipantUi>,
    viewModel: TalkieViewModel,
) {
    LazyColumn(
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(participants, key = { it.identity }) { p ->
            ParticipantRow(p, viewModel)
            Spacer(Modifier.height(6.dp))
        }
    }
}

@Composable
private fun ParticipantRow(p: ParticipantUi, viewModel: TalkieViewModel) {
    val bg = if (p.isSpeaking) Color(0xFF052E1A) else Color(0xFF171717)
    val borderColor =
        if (p.isSpeaking) MaterialTheme.colorScheme.primary else Color(0xFF262626)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(bg)
            .border(1.dp, borderColor, RoundedCornerShape(14.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(
                        if (p.isSpeaking) MaterialTheme.colorScheme.primary
                        else Color(0xFF525252),
                    ),
            )
            Spacer(Modifier.size(10.dp))
            Text(
                p.identity,
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (p.isLocal) {
                Text("(you)", color = Color(0xFF737373), fontSize = 11.sp)
            } else {
                MuteButton(p.muted) { viewModel.toggleMute(p.identity) }
            }
        }
        if (!p.isLocal) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 4.dp),
            ) {
                Text(
                    "Vol",
                    color = Color(0xFF737373),
                    fontSize = 10.sp,
                    modifier = Modifier.size(width = 28.dp, height = 16.dp),
                )
                Slider(
                    value = p.volume,
                    onValueChange = { viewModel.setParticipantVolume(p.identity, it) },
                    valueRange = 0f..1f,
                    enabled = !p.muted,
                    colors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.primary,
                        activeTrackColor = MaterialTheme.colorScheme.primary,
                        inactiveTrackColor = Color(0xFF262626),
                    ),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "${(p.volume * 100).roundToInt()}%",
                    color = Color(0xFF737373),
                    fontSize = 10.sp,
                    modifier = Modifier.size(width = 36.dp, height = 16.dp),
                )
            }
        }
    }
}

@Composable
private fun MuteButton(muted: Boolean, onClick: () -> Unit) {
    val container = if (muted) Color(0x33EF4444) else Color(0xFF262626)
    val contentColor = if (muted) Color(0xFFFCA5A5) else Color(0xFFD4D4D4)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(container)
            .border(
                1.dp,
                if (muted) Color(0xFF7F1D1D) else Color(0xFF404040),
                RoundedCornerShape(8.dp),
            )
            .pointerInput(Unit) { detectTapGestures(onTap = { onClick() }) }
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Text(
            if (muted) "Muted" else "Mute",
            color = contentColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun ChatPanel(state: TalkieState, viewModel: TalkieViewModel) {
    val listState = rememberLazyListState()
    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.size - 1)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        if (state.messages.isEmpty()) {
            Box(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "No messages yet. Say hi.",
                    color = Color(0xFF525252),
                    fontSize = 12.sp,
                )
            }
        } else {
            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) {
                items(state.messages, key = { it.id }) { m ->
                    ChatBubble(m, m.from == state.name)
                    Spacer(Modifier.height(6.dp))
                }
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF0A0A0A))
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = state.draft,
                onValueChange = viewModel::setDraft,
                placeholder = { Text("Type a message…") },
                singleLine = true,
                enabled = state.status == TalkieState.Status.Connected,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.size(8.dp))
            Button(
                onClick = viewModel::sendMessage,
                enabled = state.draft.isNotBlank() &&
                    state.status == TalkieState.Status.Connected,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.height(50.dp),
            ) {
                Text("Send", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun ChatBubble(m: ChatMessage, isMine: Boolean) {
    val bg = if (isMine) MaterialTheme.colorScheme.primary else Color(0xFF262626)
    val fg = if (isMine) MaterialTheme.colorScheme.onPrimary
    else MaterialTheme.colorScheme.onBackground
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .clip(RoundedCornerShape(14.dp))
                .background(bg)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (!isMine) {
                Text(
                    m.from,
                    color = Color(0xFF737373),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Text(m.text, color = fg, fontSize = 14.sp)
            Text(
                timeOf(m.timestamp),
                color = if (isMine) Color(0x66052E1A) else Color(0xFF525252),
                fontSize = 9.sp,
            )
        }
    }
}

@Composable
private fun ReplaysPanel(state: TalkieState, viewModel: TalkieViewModel) {
    if (state.replays.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(20.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "No voice clips yet. Anything you receive while on this channel is recorded here so you can replay it. Clips disappear when you leave the channel.",
                color = Color(0xFF737373),
                fontSize = 12.sp,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        return
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "${state.replays.size} clip${if (state.replays.size == 1) "" else "s"}",
                color = Color(0xFF737373),
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            TextLink("Clear all", viewModel::clearReplays)
        }
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(state.replays, key = { it.id }) { clip ->
                ReplayRow(
                    clip = clip,
                    playing = state.playingReplayId == clip.id,
                    onToggle = { viewModel.playReplay(clip) },
                )
                Spacer(Modifier.height(6.dp))
            }
        }
    }
}

@Composable
private fun ReplayRow(clip: ReplayClip, playing: Boolean, onToggle: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (playing) Color(0xFF052E1A) else Color(0xFF171717))
            .border(
                1.dp,
                if (playing) MaterialTheme.colorScheme.primary else Color(0xFF262626),
                RoundedCornerShape(14.dp),
            )
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
                .pointerInput(clip.id) {
                    detectTapGestures(onTap = { onToggle() })
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (playing) "■" else "▶",
                color = MaterialTheme.colorScheme.onPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.size(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                clip.from,
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${timeOf(clip.timestamp)} · ${formatDuration(clip.durationMs)}",
                color = Color(0xFF737373),
                fontSize = 10.sp,
            )
        }
    }
}

private fun formatDuration(ms: Long): String {
    val seconds = (ms / 1000.0)
    return if (seconds < 10) "%.1fs".format(seconds) else "${seconds.toInt()}s"
}

@Composable
private fun SettingsScreen(state: TalkieState, viewModel: TalkieViewModel) {
    val s = state.settings
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(20.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Settings",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            TextLink("Back", onClick = viewModel::closeSettings)
        }

        Spacer(Modifier.height(20.dp))

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF171717))
                .border(1.dp, Color(0xFF262626), RoundedCornerShape(16.dp))
                .padding(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Output volume",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 14.sp,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "${(s.outputVolume * 100).roundToInt()}%",
                    color = Color(0xFF737373),
                    fontSize = 12.sp,
                )
            }
            Slider(
                value = s.outputVolume,
                onValueChange = {
                    viewModel.updateSettings(s.copy(outputVolume = it))
                },
                valueRange = 0f..1f,
                colors = SliderDefaults.colors(
                    thumbColor = MaterialTheme.colorScheme.primary,
                    activeTrackColor = MaterialTheme.colorScheme.primary,
                    inactiveTrackColor = Color(0xFF262626),
                ),
            )

            Spacer(Modifier.height(8.dp))
            SettingsToggle(
                label = "Beep on incoming",
                description = "Short tone when someone starts talking",
                checked = s.beepOnIncoming,
                onCheckedChange = {
                    viewModel.updateSettings(s.copy(beepOnIncoming = it))
                },
            )

            Spacer(Modifier.height(8.dp))
            SettingsToggle(
                label = "Vibrate on incoming",
                description = "Light haptic pulse",
                checked = s.vibrateOnIncoming,
                onCheckedChange = {
                    viewModel.updateSettings(s.copy(vibrateOnIncoming = it))
                },
            )
        }

        Spacer(Modifier.height(16.dp))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF171717))
                .border(1.dp, Color(0xFF262626), RoundedCornerShape(16.dp))
                .padding(16.dp),
        ) {
            Text(
                "About",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Audio is routed through LiveKit; nothing is recorded server-side.",
                color = Color(0xFF737373),
                fontSize = 11.sp,
            )
        }
    }
}

@Composable
private fun SettingsToggle(
    label: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                label,
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 13.sp,
            )
            Text(description, color = Color(0xFF737373), fontSize = 11.sp)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                checkedTrackColor = MaterialTheme.colorScheme.primary,
                uncheckedThumbColor = Color(0xFF737373),
                uncheckedTrackColor = Color(0xFF262626),
            ),
        )
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
        Text(label, color = Color(0xFFA3A3A3), fontSize = 11.sp)
    }
}

@Composable
private fun TextLink(label: String, onClick: () -> Unit) {
    Text(
        label,
        color = Color(0xFFA3A3A3),
        fontSize = 12.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .pointerInput(Unit) { detectTapGestures(onTap = { onClick() }) }
            .padding(horizontal = 6.dp, vertical = 4.dp),
    )
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
            .background(MaterialTheme.colorScheme.background)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Hold to talk", color = Color(0xFF737373), fontSize = 11.sp)
        Spacer(Modifier.height(10.dp))
        Box(
            modifier = Modifier
                .size(140.dp)
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
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

private fun timeOf(ts: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts))

private fun relativeTime(ts: Long): String {
    val diff = System.currentTimeMillis() - ts
    val m = (diff / 60_000).toInt()
    if (m < 1) return "just now"
    if (m < 60) return "${m}m ago"
    val h = m / 60
    if (h < 24) return "${h}h ago"
    val d = h / 24
    return "${d}d ago"
}

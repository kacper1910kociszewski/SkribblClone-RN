// app/game.tsx
import { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, PanResponder, Platform,
    TouchableOpacity, TextInput, FlatList, KeyboardAvoidingView, ScrollView
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { io } from 'socket.io-client';
import Svg, { Path } from 'react-native-svg';

const socket = io("http://192.168.3.106:3000");
const VIRTUAL_SIZE = 1000;

type ChatMessage = { username: string; message: string; created_at: string };
type RoomPhase = 'waiting' | 'choosing' | 'drawing';
type DrawTool = 'pen' | 'eraser';
type ScoreRow = { username: string; points: number };
type StrokeData = {
    path: string;
    color: string;
    strokeWidth: number;
    tool: DrawTool;
};
type RoomStatePayload = {
    players: string[];
    scores?: ScoreRow[];
    matchActive?: boolean;
    currentRound?: number;
    maxRounds?: number;
    drawerSocketId: string | null;
    drawerUsername: string | null;
    phase: RoomPhase;
};
type TimerPayload = { phase: RoomPhase; secondsLeft: number };
type RoundEndPayload = {
    word: string;
    winnerUsername: string | null;
    reason: 'guessed' | 'time-up';
    currentRound?: number;
    maxRounds?: number;
};
type MatchEndedPayload = {
    reason: 'round-limit' | 'stopped';
    standings: ScoreRow[];
    winners: string[];
    currentRound: number;
    maxRounds: number;
};

const PALETTE = ['#111111', '#f44336', '#ff9800', '#ffeb3b', '#4caf50', '#00bcd4', '#2196f3', '#9c27b0'];

function parseStoredStroke(value: string): StrokeData {
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed.path === 'string') {
            const color = typeof parsed.color === 'string' ? parsed.color : '#111111';
            const strokeWidth = Number.isFinite(Number(parsed.strokeWidth)) ? Number(parsed.strokeWidth) : 5;
            const tool: DrawTool = parsed.tool === 'eraser' ? 'eraser' : 'pen';
            return { path: parsed.path, color, strokeWidth, tool };
        }
    } catch {
        return { path: value, color: '#111111', strokeWidth: 5, tool: 'pen' };
    }

    return { path: value, color: '#111111', strokeWidth: 5, tool: 'pen' };
}

export default function GameSession() {
    const { username, roomCode } = useLocalSearchParams<{ username: string; roomCode: string }>();
    const router = useRouter();

    // Canvas state
    const [currentPath, setCurrentPath] = useState('');
    const [paths, setPaths] = useState<StrokeData[]>([]);
    const [remoteLiveStroke, setRemoteLiveStroke] = useState<StrokeData | null>(null);
    const [selectedColor, setSelectedColor] = useState('#111111');
    const [selectedTool, setSelectedTool] = useState<DrawTool>('pen');

    // Chat state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const chatRef = useRef<FlatList>(null);

    // Game state
    const [roomPlayers, setRoomPlayers] = useState<string[]>([]);
    const [drawerSocketId, setDrawerSocketId] = useState<string | null>(null);
    const [drawerUsername, setDrawerUsername] = useState<string | null>(null);
    const [phase, setPhase] = useState<RoomPhase>('waiting');
    const [displayWord, setDisplayWord] = useState('');
    const [wordOptions, setWordOptions] = useState<string[]>([]);
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [scores, setScores] = useState<ScoreRow[]>([]);
    const [matchActive, setMatchActive] = useState(false);
    const [currentRound, setCurrentRound] = useState(0);
    const [maxRounds, setMaxRounds] = useState(10);
    const [roundsInput, setRoundsInput] = useState('10');
    const [matchResult, setMatchResult] = useState<MatchEndedPayload | null>(null);
    const [isCanvasTouchActive, setIsCanvasTouchActive] = useState(false);

    const canvasRef = useRef<View>(null);
    const layout = useRef({ width: 0, height: 0, left: 0, top: 0 });
    const canDraw = drawerSocketId === socket.id && phase === 'drawing';
    const isDrawer = drawerSocketId === socket.id;

    // ===== SOCKET SETUP =====
    useEffect(() => {
        socket.emit("join-room", { roomCode, username });

        socket.on("canvas-history", (history: string[]) => {
            setPaths((history || []).map(parseStoredStroke));
            setRemoteLiveStroke(null);
        });
        socket.on("chat-history", (history: ChatMessage[]) => setMessages(history));
        socket.on("room-state", (payload: RoomStatePayload) => {
            setRoomPlayers(payload.players || []);
            setScores(payload.scores || []);
            setMatchActive(Boolean(payload.matchActive));
            setCurrentRound(payload.currentRound || 0);
            setMaxRounds(payload.maxRounds || 10);
            if (payload.maxRounds) {
                setRoundsInput(String(payload.maxRounds));
            }
            setDrawerSocketId(payload.drawerSocketId || null);
            setDrawerUsername(payload.drawerUsername || null);
            setPhase(payload.phase || 'waiting');
            if (payload.phase !== 'choosing') {
                setWordOptions([]);
            }
        });
        socket.on("word-options", (options: string[]) => setWordOptions(options));
        socket.on("round-start", ({ displayWord: nextWord }: { displayWord: string }) => {
            setDisplayWord(nextWord || '');
            setWordOptions([]);
        });
        socket.on("round-word-update", ({ displayWord: nextWord }: { displayWord: string }) => {
            setDisplayWord(nextWord || '');
        });
        socket.on("timer-update", ({ secondsLeft: nextSeconds }: TimerPayload) => {
            setSecondsLeft(nextSeconds || 0);
        });
        socket.on("round-end", ({ word, winnerUsername, reason }: RoundEndPayload) => {
            setDisplayWord(word || '');
            const systemMessage = {
                username: 'System',
                message: reason === 'guessed' && winnerUsername
                    ? `${winnerUsername} won the round. Word was "${word}".`
                    : `Time is up. Word was "${word}".`,
                created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, systemMessage]);
        });
        socket.on("match-ended", (payload: MatchEndedPayload) => {
            setMatchActive(false);
            setMatchResult(payload);
            setCurrentRound(payload.currentRound || 0);
            setMaxRounds(payload.maxRounds || 10);
            const winnerText = payload.winners.length > 0
                ? `Winner${payload.winners.length > 1 ? 's' : ''}: ${payload.winners.join(', ')}`
                : 'No winner';
            setMessages((prev) => [
                ...prev,
                {
                    username: 'System',
                    message: `Match ended (${payload.reason}). ${winnerText}.`,
                    created_at: new Date().toISOString(),
                },
            ]);
        });
        socket.on("join-error", ({ message }: { message: string }) => {
            setMessages((prev) => [
                ...prev,
                {
                    username: 'System',
                    message: message || 'Unable to join room.',
                    created_at: new Date().toISOString(),
                },
            ]);
            router.replace('/');
        });

        socket.on("remote-draw", (payload: StrokeData | string) => {
            const stroke = typeof payload === 'string' ? parseStoredStroke(payload) : payload;
            if (!stroke?.path) return;
            setPaths(prev => [...prev, {
                path: stroke.path,
                color: stroke.color || '#111111',
                strokeWidth: stroke.strokeWidth || 5,
                tool: stroke.tool === 'eraser' ? 'eraser' : 'pen',
            }]);
            setRemoteLiveStroke(null);
        });
        socket.on("remote-mid-draw", ({ path, color, strokeWidth, tool }: StrokeData) => {
            if (!path) return;
            setRemoteLiveStroke({
                path,
                color: color || '#111111',
                strokeWidth: strokeWidth || 5,
                tool: tool === 'eraser' ? 'eraser' : 'pen',
            });
        });
        socket.on("clear-canvas", () => { setPaths([]); setCurrentPath(''); });
        socket.on("remote-chat", (msg: ChatMessage) => {
            setMessages(prev => [...prev, msg]);
        });

        return () => {
            socket.off("canvas-history");
            socket.off("chat-history");
            socket.off("room-state");
            socket.off("word-options");
            socket.off("round-start");
            socket.off("round-word-update");
            socket.off("timer-update");
            socket.off("round-end");
            socket.off("match-ended");
            socket.off("join-error");
            socket.off("remote-draw");
            socket.off("remote-mid-draw");
            socket.off("clear-canvas");
            socket.off("remote-chat");
        };
    }, [roomCode, username, router]);

    // Auto-scroll chat to bottom
    useEffect(() => {
        if (messages.length > 0) {
            chatRef.current?.scrollToEnd({ animated: true });
        }
    }, [messages]);

    // ===== LAYOUT =====
    const updateLayout = () => {
        if (Platform.OS === 'web') {
            const rect = (canvasRef.current as any)?.getBoundingClientRect();
            if (rect) layout.current = { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
        } else {
            canvasRef.current?.measure((x, y, w, h, px, py) => {
                layout.current = { width: w, height: h, left: px, top: py };
            });
        }
    };

    // ===== DRAWING =====
    const panResponder = PanResponder.create({
        onStartShouldSetPanResponder: () => canDraw,
        onPanResponderGrant: (evt) => {
            if (!canDraw) return;
            setIsCanvasTouchActive(true);
            updateLayout();
            const { pageX, pageY } = evt.nativeEvent;
            const vX = ((pageX - layout.current.left) / layout.current.width) * VIRTUAL_SIZE;
            const vY = ((pageY - layout.current.top) / layout.current.height) * VIRTUAL_SIZE;
            setCurrentPath(`M${vX},${vY}`);
        },
        onPanResponderMove: (evt) => {
            if (!canDraw) return;
            const { pageX, pageY } = evt.nativeEvent;
            const vX = ((pageX - layout.current.left) / layout.current.width) * VIRTUAL_SIZE;
            const vY = ((pageY - layout.current.top) / layout.current.height) * VIRTUAL_SIZE;
            const newPath = `${currentPath} L${vX},${vY}`;
            setCurrentPath(newPath);
            socket.emit("mid-draw", {
                path: newPath,
                roomCode,
                color: selectedTool === 'eraser' ? '#ffffff' : selectedColor,
                strokeWidth: selectedTool === 'eraser' ? 20 : 5,
                tool: selectedTool,
            });
        },
        onPanResponderRelease: () => {
            setIsCanvasTouchActive(false);
            if (!canDraw) return;
            if (currentPath) {
                const stroke: StrokeData = {
                    path: currentPath,
                    color: selectedTool === 'eraser' ? '#ffffff' : selectedColor,
                    strokeWidth: selectedTool === 'eraser' ? 20 : 5,
                    tool: selectedTool,
                };
                setPaths(prev => [...prev, stroke]);
                socket.emit("draw", { roomCode, ...stroke });
                setCurrentPath('');
            }
        },
        onPanResponderTerminate: () => {
            setIsCanvasTouchActive(false);
            setCurrentPath('');
        },
    });

    const chooseWord = (word: string) => {
        socket.emit('choose-word', { roomCode, word });
        setWordOptions([]);
    };

    const startMatch = () => {
        const parsed = Number(roundsInput);
        const bounded = Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 30) : 10;
        socket.emit('start-match', { roomCode, maxRounds: bounded });
        setMatchResult(null);
    };

    const stopMatch = () => {
        socket.emit('stop-match', { roomCode });
    };

    // ===== CHAT SEND =====
    const sendMessage = () => {
        if (isDrawer && phase === 'drawing') return;
        if (!chatInput.trim()) return;
        socket.emit("chat-message", { roomCode, username, message: chatInput });
        setChatInput('');
    };

    // ===== RENDER =====
    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                scrollEnabled={!isCanvasTouchActive}
            >
                <Text style={styles.header}>Room: {roomCode} | Player: {username}</Text>
                <Text style={styles.subHeader}>Players: {roomPlayers.length} | Drawer: {drawerUsername || '-'}</Text>
                <Text style={styles.subHeader}>
                    {phase === 'waiting' ? 'Waiting for players...' : phase === 'choosing' ? 'Choosing a word...' : 'Drawing in progress'}
                </Text>
                <Text style={styles.subHeader}>Match: {matchActive ? 'Active' : 'Stopped'} | Round: {currentRound}/{maxRounds}</Text>
                {roomPlayers.length < 2 ? (
                    <Text style={styles.waitingHint}>Need at least 2 players. Round timer is paused.</Text>
                ) : null}
                <Text style={styles.timerText}>Time: {secondsLeft}s</Text>
                <Text style={styles.wordText}>{displayWord ? `Word: ${displayWord}` : 'Word: -'}</Text>

                <View style={styles.matchControls}>
                    <TextInput
                        style={styles.roundsInput}
                        value={roundsInput}
                        onChangeText={setRoundsInput}
                        keyboardType="number-pad"
                        maxLength={2}
                        editable={!matchActive}
                        placeholder="10"
                        placeholderTextColor="#9bb0c3"
                    />
                    <TouchableOpacity
                        style={[styles.matchBtn, styles.startBtn, (matchActive || roomPlayers.length < 2) && styles.disabledBtn]}
                        onPress={startMatch}
                        disabled={matchActive || roomPlayers.length < 2}
                    >
                        <Text style={styles.matchBtnText}>Start Match</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.matchBtn, styles.stopBtn, !matchActive && styles.disabledBtn]}
                        onPress={stopMatch}
                        disabled={!matchActive}
                    >
                        <Text style={styles.matchBtnText}>Stop Match</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.scoreBoard}>
                    <Text style={styles.scoreTitle}>Scoreboard</Text>
                    {scores.length === 0 ? (
                        <Text style={styles.scoreRowText}>No players yet</Text>
                    ) : (
                        scores
                            .slice()
                            .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username))
                            .map((row) => (
                                <View key={row.username} style={styles.scoreRow}>
                                    <Text style={styles.scoreRowName}>{row.username}</Text>
                                    <Text style={styles.scoreRowPoints}>{row.points}</Text>
                                </View>
                            ))
                    )}
                </View>

                {matchResult ? (
                    <View style={styles.resultBlock}>
                        <Text style={styles.resultTitle}>Match Finished</Text>
                        <Text style={styles.resultSubtitle}>
                            {matchResult.reason === 'stopped' ? 'Stopped manually' : `Reached ${matchResult.maxRounds} rounds`}
                        </Text>
                        {matchResult.standings.map((row) => (
                            <View key={`result-${row.username}`} style={styles.resultRow}>
                                <Text style={styles.resultName}>{row.username}</Text>
                                <Text style={styles.resultPoints}>{row.points} pts</Text>
                            </View>
                        ))}
                    </View>
                ) : null}

                {isDrawer && phase === 'choosing' && wordOptions.length > 0 ? (
                    <View style={styles.wordChooser}>
                        {wordOptions.map((word) => (
                            <TouchableOpacity key={word} style={styles.wordBtn} onPress={() => chooseWord(word)}>
                                <Text style={styles.wordBtnText}>{word}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                ) : null}

                <TouchableOpacity
                    style={[styles.clearBtn, !canDraw && styles.disabledBtn]}
                    onPress={() => socket.emit("clear-canvas", roomCode)}
                    disabled={!canDraw}
                >
                    <Text style={styles.clearBtnText}>Clear Board</Text>
                </TouchableOpacity>

                <View style={styles.toolBar}>
                    <View style={styles.toolSection}>
                        <Text style={styles.toolLabel}>Tools</Text>
                        <TouchableOpacity
                            style={[styles.toolBtn, selectedTool === 'pen' && styles.toolBtnActive, !canDraw && styles.disabledBtn]}
                            onPress={() => setSelectedTool('pen')}
                            disabled={!canDraw}
                        >
                            <Text style={styles.toolBtnText}>Pen</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.toolBtn, selectedTool === 'eraser' && styles.toolBtnActive, !canDraw && styles.disabledBtn]}
                            onPress={() => setSelectedTool('eraser')}
                            disabled={!canDraw}
                        >
                            <Text style={styles.toolBtnText}>Eraser</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.toolSection}>
                        <Text style={styles.toolLabel}>Colors</Text>
                        <View style={styles.colorList}>
                            {PALETTE.map((color) => (
                                <TouchableOpacity
                                    key={color}
                                    style={[
                                        styles.colorSwatch,
                                        { backgroundColor: color },
                                        selectedColor === color && selectedTool === 'pen' ? styles.colorSwatchActive : null,
                                        !canDraw && styles.disabledBtn,
                                    ]}
                                    onPress={() => {
                                        setSelectedTool('pen');
                                        setSelectedColor(color);
                                    }}
                                    disabled={!canDraw}
                                />
                            ))}
                        </View>
                    </View>
                </View>

                <View
                    ref={canvasRef}
                    onLayout={updateLayout}
                    onTouchStart={() => {
                        if (canDraw) setIsCanvasTouchActive(true);
                    }}
                    onTouchEnd={() => setIsCanvasTouchActive(false)}
                    onTouchCancel={() => setIsCanvasTouchActive(false)}
                    style={styles.canvas}
                    {...panResponder.panHandlers}
                >
                    <Svg viewBox={`0 0 ${VIRTUAL_SIZE} ${VIRTUAL_SIZE}`}>
                        {paths.map((stroke, i) => (
                            <Path
                                key={i}
                                d={stroke.path}
                                stroke={stroke.tool === 'eraser' ? '#ffffff' : stroke.color}
                                strokeWidth={stroke.strokeWidth}
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        ))}
                        <Path
                            d={currentPath}
                            stroke={selectedTool === 'eraser' ? '#ffffff' : selectedColor}
                            strokeWidth={selectedTool === 'eraser' ? 20 : 5}
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        {remoteLiveStroke?.path ? (
                            <Path
                                d={remoteLiveStroke.path}
                                stroke={remoteLiveStroke.tool === 'eraser' ? '#ffffff' : remoteLiveStroke.color}
                                strokeWidth={remoteLiveStroke.strokeWidth}
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        ) : null}
                    </Svg>
                </View>
            </ScrollView>

            <View style={styles.chatContainer}>
                <FlatList
                    ref={chatRef}
                    data={messages}
                    keyExtractor={(_, i) => String(i)}
                    style={styles.messageList}
                    renderItem={({ item }) => (
                        <View style={styles.messageRow}>
                            <Text style={styles.messageUser}>{item.username}: </Text>
                            <Text style={styles.messageText}>{item.message}</Text>
                        </View>
                    )}
                />
                <View style={styles.chatInputRow}>
                    <TextInput
                        style={styles.chatInput}
                        value={chatInput}
                        onChangeText={setChatInput}
                        placeholder={isDrawer && phase === 'drawing' ? 'Drawer chat disabled' : 'Type a message...'}
                        placeholderTextColor="#888"
                        onSubmitEditing={sendMessage}
                        returnKeyType="send"
                        editable={!(isDrawer && phase === 'drawing')}
                    />
                    <TouchableOpacity
                        style={[styles.sendBtn, isDrawer && phase === 'drawing' ? styles.disabledBtn : null]}
                        onPress={sendMessage}
                        disabled={isDrawer && phase === 'drawing'}
                    >
                        <Text style={styles.sendBtnText}>Send</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

// ===== STYLES =====
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#222', paddingTop: 60, alignItems: 'stretch' },
    scrollArea: { flex: 1, width: '100%' },
    scrollContent: { alignItems: 'center', paddingBottom: 12 },
    header: { color: 'white', fontWeight: 'bold', marginBottom: 10 },
    subHeader: { color: '#c9d0d9', marginBottom: 4, fontSize: 13 },
    waitingHint: { color: '#ffb4a2', marginBottom: 6, fontSize: 12, fontWeight: '600' },
    matchControls: {
        width: '90%',
        maxWidth: 500,
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
        marginBottom: 10,
    },
    roundsInput: {
        width: 60,
        backgroundColor: '#1f2a36',
        color: 'white',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        textAlign: 'center',
    },
    matchBtn: {
        flex: 1,
        borderRadius: 8,
        paddingVertical: 9,
        alignItems: 'center',
    },
    startBtn: { backgroundColor: '#2e8b57' },
    stopBtn: { backgroundColor: '#b54848' },
    matchBtnText: { color: 'white', fontWeight: '700', fontSize: 12 },
    scoreBoard: {
        width: '90%',
        maxWidth: 500,
        backgroundColor: '#2a2f36',
        borderRadius: 10,
        padding: 10,
        marginBottom: 10,
    },
    scoreTitle: { color: '#ffd56f', fontWeight: '800', marginBottom: 6 },
    scoreRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    scoreRowText: { color: '#d9e0e7', fontSize: 12 },
    scoreRowName: { color: '#d9e0e7', fontSize: 12, fontWeight: '600' },
    scoreRowPoints: { color: '#8ee6a5', fontSize: 12, fontWeight: '700' },
    resultBlock: {
        width: '90%',
        maxWidth: 500,
        backgroundColor: '#fff7df',
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#f3c75f',
    },
    resultTitle: { color: '#704f00', fontWeight: '800', fontSize: 16, marginBottom: 2 },
    resultSubtitle: { color: '#8a6507', fontSize: 12, marginBottom: 8 },
    resultRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    resultName: { color: '#503700', fontWeight: '700' },
    resultPoints: { color: '#7d5600', fontWeight: '800' },
    timerText: { color: '#8ee6a5', marginBottom: 6, fontWeight: '600' },
    wordText: { color: '#ffdf70', fontWeight: 'bold', marginBottom: 8, fontSize: 15 },
    wordChooser: { flexDirection: 'row', marginBottom: 10, gap: 8 },
    wordBtn: { backgroundColor: '#3a7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    wordBtnText: { color: 'white', fontWeight: 'bold', textTransform: 'capitalize' },
    toolBar: {
        width: '90%',
        maxWidth: 500,
        flexDirection: 'row',
        gap: 10,
        marginBottom: 10,
    },
    toolSection: {
        flex: 1,
        backgroundColor: '#2e2e2e',
        borderRadius: 10,
        padding: 10,
    },
    toolLabel: { color: '#d2d9e0', fontSize: 12, fontWeight: '700', marginBottom: 8 },
    toolBtn: {
        backgroundColor: '#494949',
        borderRadius: 8,
        paddingVertical: 8,
        alignItems: 'center',
        marginBottom: 6,
    },
    toolBtnActive: { backgroundColor: '#2d7ef7' },
    toolBtnText: { color: 'white', fontWeight: '700', fontSize: 12 },
    colorList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    colorSwatch: {
        width: 24,
        height: 24,
        borderRadius: 999,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    colorSwatchActive: { borderColor: '#ffffff' },
    canvas: { width: '90%', maxWidth: 500, aspectRatio: 1, backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
    clearBtn: { backgroundColor: '#ff4444', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, marginBottom: 10 },
    disabledBtn: { opacity: 0.5 },
    clearBtnText: { color: 'white', fontWeight: 'bold' },
    chatContainer: {
        width: '90%',
        maxWidth: 500,
        alignSelf: 'center',
        height: 220,
        marginTop: 8,
        marginBottom: 12,
        backgroundColor: '#333',
        borderRadius: 12,
        overflow: 'hidden',
    },
    messageList: { flex: 1, padding: 8 },
    messageRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
    messageUser: { color: '#4af', fontWeight: 'bold', fontSize: 13 },
    messageText: { color: '#eee', fontSize: 13 },
    chatInputRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#555' },
    chatInput: { flex: 1, color: 'white', padding: 10, fontSize: 14 },
    sendBtn: { backgroundColor: '#4af', paddingHorizontal: 16, justifyContent: 'center' },
    sendBtnText: { color: 'white', fontWeight: 'bold' },
});

// app/game.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, PanResponder, Platform,
    TouchableOpacity, TextInput, FlatList, KeyboardAvoidingView
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import io from 'socket.io-client';
import Svg, { Path } from 'react-native-svg';

const socket = io("http://192.168.1.227:3000");
const VIRTUAL_SIZE = 1000;

type ChatMessage = { username: string; message: string; created_at: string };
type RoomPhase = 'waiting' | 'choosing' | 'drawing';
type RoomStatePayload = {
    players: string[];
    drawerSocketId: string | null;
    drawerUsername: string | null;
    phase: RoomPhase;
};
type TimerPayload = { phase: RoomPhase; secondsLeft: number };
type RoundEndPayload = { word: string; winnerUsername: string | null; reason: 'guessed' | 'time-up' };

export default function GameSession() {
    const { username, roomCode } = useLocalSearchParams<{ username: string; roomCode: string }>();

    // Canvas state
    const [currentPath, setCurrentPath] = useState('');
    const [paths, setPaths] = useState<string[]>([]);
    const [remoteLivePath, setRemoteLivePath] = useState('');

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

    const canvasRef = useRef<View>(null);
    const layout = useRef({ width: 0, height: 0, left: 0, top: 0 });
    const canDraw = drawerSocketId === socket.id && phase === 'drawing';
    const isDrawer = drawerSocketId === socket.id;

    // ===== SOCKET SETUP =====
    useEffect(() => {
        socket.emit("join-room", { roomCode, username });

        socket.on("canvas-history", (history: string[]) => setPaths(history));
        socket.on("chat-history", (history: ChatMessage[]) => setMessages(history));
        socket.on("room-state", (payload: RoomStatePayload) => {
            setRoomPlayers(payload.players || []);
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

        socket.on("remote-draw", (path: string) => {
            setPaths(prev => [...prev, path]);
            setRemoteLivePath('');
        });
        socket.on("remote-mid-draw", ({ path }: { path: string }) => setRemoteLivePath(path));
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
            socket.off("remote-draw");
            socket.off("remote-mid-draw");
            socket.off("clear-canvas");
            socket.off("remote-chat");
        };
    }, [roomCode, username]);

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
            socket.emit("mid-draw", { path: newPath, roomCode });
        },
        onPanResponderRelease: () => {
            if (!canDraw) return;
            if (currentPath) {
                setPaths(prev => [...prev, currentPath]);
                socket.emit("draw", { path: currentPath, roomCode });
                setCurrentPath('');
            }
        },
    });

    const chooseWord = (word: string) => {
        socket.emit('choose-word', { roomCode, word });
        setWordOptions([]);
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
            <Text style={styles.header}>Room: {roomCode} | Player: {username}</Text>
            <Text style={styles.subHeader}>Players: {roomPlayers.length} | Drawer: {drawerUsername || '-'}</Text>
            <Text style={styles.subHeader}>
                {phase === 'waiting' ? 'Waiting for players...' : phase === 'choosing' ? 'Choosing a word...' : 'Drawing in progress'}
            </Text>
            <Text style={styles.timerText}>Time: {secondsLeft}s</Text>
            <Text style={styles.wordText}>{displayWord ? `Word: ${displayWord}` : 'Word: -'}</Text>

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

            {/* Canvas */}
            <View
                ref={canvasRef}
                onLayout={updateLayout}
                style={styles.canvas}
                {...panResponder.panHandlers}
            >
                <Svg viewBox={`0 0 ${VIRTUAL_SIZE} ${VIRTUAL_SIZE}`}>
                    {paths.map((d, i) => <Path key={i} d={d} stroke="black" strokeWidth={5} fill="none" />)}
                    <Path d={currentPath} stroke="blue" strokeWidth={5} fill="none" />
                    <Path d={remoteLivePath} stroke="red" strokeWidth={5} fill="none" />
                </Svg>
            </View>

            {/* Chat */}
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
    container: { flex: 1, backgroundColor: '#222', paddingTop: 60, alignItems: 'center' },
    header: { color: 'white', fontWeight: 'bold', marginBottom: 10 },
    subHeader: { color: '#c9d0d9', marginBottom: 4, fontSize: 13 },
    timerText: { color: '#8ee6a5', marginBottom: 6, fontWeight: '600' },
    wordText: { color: '#ffdf70', fontWeight: 'bold', marginBottom: 8, fontSize: 15 },
    wordChooser: { flexDirection: 'row', marginBottom: 10, gap: 8 },
    wordBtn: { backgroundColor: '#3a7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    wordBtnText: { color: 'white', fontWeight: 'bold', textTransform: 'capitalize' },
    canvas: { width: '90%', maxWidth: 500, aspectRatio: 1, backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
    clearBtn: { backgroundColor: '#ff4444', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, marginBottom: 10 },
    disabledBtn: { opacity: 0.5 },
    clearBtnText: { color: 'white', fontWeight: 'bold' },
    chatContainer: { width: '90%', maxWidth: 500, flex: 1, marginTop: 12, backgroundColor: '#333', borderRadius: 12, overflow: 'hidden' },
    messageList: { flex: 1, padding: 8 },
    messageRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
    messageUser: { color: '#4af', fontWeight: 'bold', fontSize: 13 },
    messageText: { color: '#eee', fontSize: 13 },
    chatInputRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#555' },
    chatInput: { flex: 1, color: 'white', padding: 10, fontSize: 14 },
    sendBtn: { backgroundColor: '#4af', paddingHorizontal: 16, justifyContent: 'center' },
    sendBtnText: { color: 'white', fontWeight: 'bold' },
});

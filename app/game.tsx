// app/game.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, PanResponder, Platform,
    TouchableOpacity, TextInput, FlatList, KeyboardAvoidingView
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import io from 'socket.io-client';
import Svg, { Path } from 'react-native-svg';

const socket = io("http://192.168.18.6:3000");
const VIRTUAL_SIZE = 1000;

type ChatMessage = { username: string; message: string; created_at: string };

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

    const canvasRef = useRef<View>(null);
    const layout = useRef({ width: 0, height: 0, left: 0, top: 0 });

    // ===== SOCKET SETUP =====
    useEffect(() => {
        socket.emit("join-room", roomCode);

        socket.on("canvas-history", (history: string[]) => setPaths(history));
        socket.on("chat-history", (history: ChatMessage[]) => setMessages(history));

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
            socket.off("remote-draw");
            socket.off("remote-mid-draw");
            socket.off("clear-canvas");
            socket.off("remote-chat");
        };
    }, [roomCode]);

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
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
            updateLayout();
            const { pageX, pageY } = evt.nativeEvent;
            const vX = ((pageX - layout.current.left) / layout.current.width) * VIRTUAL_SIZE;
            const vY = ((pageY - layout.current.top) / layout.current.height) * VIRTUAL_SIZE;
            setCurrentPath(`M${vX},${vY}`);
        },
        onPanResponderMove: (evt) => {
            const { pageX, pageY } = evt.nativeEvent;
            const vX = ((pageX - layout.current.left) / layout.current.width) * VIRTUAL_SIZE;
            const vY = ((pageY - layout.current.top) / layout.current.height) * VIRTUAL_SIZE;
            const newPath = `${currentPath} L${vX},${vY}`;
            setCurrentPath(newPath);
            socket.emit("mid-draw", { path: newPath, roomCode });
        },
        onPanResponderRelease: () => {
            if (currentPath) {
                setPaths(prev => [...prev, currentPath]);
                socket.emit("draw", { path: currentPath, roomCode });
                setCurrentPath('');
            }
        },
    });

    // ===== CHAT SEND =====
    const sendMessage = () => {
        if (!chatInput.trim()) return;
        socket.emit("chat-message", { roomCode, username, message: chatInput });
        setChatInput('');
    };

    // ===== RENDER =====
    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Text style={styles.header}>Room: {roomCode} | Player: {username}</Text>

            <TouchableOpacity style={styles.clearBtn} onPress={() => socket.emit("clear-canvas", roomCode)}>
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
                        placeholder="Type a message..."
                        placeholderTextColor="#888"
                        onSubmitEditing={sendMessage}
                        returnKeyType="send"
                    />
                    <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
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
    canvas: { width: '90%', maxWidth: 500, aspectRatio: 1, backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
    clearBtn: { backgroundColor: '#ff4444', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, marginBottom: 10 },
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
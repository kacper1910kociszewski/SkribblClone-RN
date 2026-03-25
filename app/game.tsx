import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, PanResponder, Platform, TouchableOpacity } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import io from 'socket.io-client';
import Svg, { Path } from 'react-native-svg';

const socket = io("http://192.168.1.227:3000"); // Use your IP
const VIRTUAL_SIZE = 1000; // Virtual canvas size for consistent drawing across devices

export default function GameSession() {
    const { username, roomCode } = useLocalSearchParams()
    const [currentPath, setCurrentPath] = useState('')
    const [paths, setPaths] = useState<string[]>([])
    const [remoteLivePath, setRemoteLivePath] = useState('')

    const canvasRef = useRef<View>(null)
    const layout = useRef({ width: 0, height: 0, left: 0, top: 0 })

    ///=================================================\
    //|     SOCKET LOGIC: Joining & Syncing History     |
    //\=================================================/
    useEffect(() => {
        socket.emit("join-room", roomCode)
        socket.on("canvas-history", (history: string[]) => setPaths(history))
        socket.on("remote-draw", (path: string) => setPaths((prev) => [...prev, path]))
        socket.on("clear-canvas", () => { setPaths([]), setCurrentPath('') })
        socket.on("remote-mid-draw", ({ path }) => { setRemoteLivePath(path) })
        socket.on("remote-draw", (path: string) => { setPaths((prev) => [...prev, path]), setRemoteLivePath('') }) // Reset the temporary line

        return () => {
            socket.off("canvas-history")
            socket.off("remote-draw")
        };
    }, [roomCode])

    ///=================================================\
    //|   LAYOUT: Fixing the PC/Web Coordinate Bug      |
    //\=================================================/
    const updateLayout = () => {
        if (Platform.OS === 'web') {
            const rect = (canvasRef.current as any)?.getBoundingClientRect()
            if (rect) layout.current = { width: rect.width, height: rect.height, left: rect.left, top: rect.top }
        } else {
            canvasRef.current?.measure((x, y, w, h, px, py) => {
                layout.current = { width: w, height: h, left: px, top: py }
            });
        }
    };

    ///=================================================\
    //|    Drawing Logic: Virtual 1000x1000 Mapping     |
    //\=================================================/
    const panResponder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
            updateLayout()
            const { pageX, pageY } = evt.nativeEvent;
            const vX = ((pageX - layout.current.left) / layout.current.width) * VIRTUAL_SIZE
            const vY = ((pageY - layout.current.top) / layout.current.height) * VIRTUAL_SIZE
            setCurrentPath(`M${vX},${vY}`)
        },
        onPanResponderMove: (evt) => {
            const { pageX, pageY } = evt.nativeEvent;
            const vX = ((pageX - layout.current.left) / layout.current.width) * VIRTUAL_SIZE;
            const vY = ((pageY - layout.current.top) / layout.current.height) * VIRTUAL_SIZE;

            const newPath = `${currentPath} L${vX},${vY}`;
            setCurrentPath(newPath);

            // EMIT LIVE DATA
            socket.emit("mid-draw", { path: newPath, roomCode });
        },
        onPanResponderRelease: () => {
            if (currentPath) {
                setPaths((prev) => [...prev, currentPath])
                socket.emit("draw", { path: currentPath, roomCode })
                setCurrentPath('')
            }
        },
    });

///==================================\
//|            RENDER                |
//\==================================/
    return (
        <View style={styles.container}>
            <Text style={styles.header}>Room: {roomCode} | Player: {username}</Text>
            <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => socket.emit("clear-canvas", roomCode)}
            >
                <Text style={styles.clearBtnText}>Clear Board</Text>
            </TouchableOpacity>
            <View
                ref={canvasRef}
                onLayout={updateLayout}
                style={styles.canvas}
                {...panResponder.panHandlers}
            >
                <Svg viewBox={`0 0 ${VIRTUAL_SIZE} ${VIRTUAL_SIZE}`}>
                    {paths.map((d, i) => (
                        <Path key={i} d={d} stroke="black" strokeWidth={5} fill="none" />
                    ))}
                    {/* Your own local live line */}
                    <Path d={currentPath} stroke="blue" strokeWidth={5} fill="none" />

                    {/* THE OTHER PLAYER'S LIVE LINE */}
                    <Path d={remoteLivePath} stroke="red" strokeWidth={5} fill="none" />
                </Svg>
            </View>
        </View>
    );
}

///==================================\
//|            STYLES                |
//\==================================/
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#222',
        paddingTop: 60,
        alignItems: 'center'
    },
    header: {
        color: 'white',
        fontWeight: 'bold',
        marginBottom: 15
    },
    canvas: {
        width: '90%',
        maxWidth: 500,
        aspectRatio: 1,
        backgroundColor: 'white',
        borderRadius: 12,
        overflow: 'hidden'
    },
    clearBtn: {
        backgroundColor: '#ff4444',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
        marginBottom: 15,
        elevation: 5,
    },
    clearBtnText: {
        color: 'white',
        fontWeight: 'bold',
    },
});
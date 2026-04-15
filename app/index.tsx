import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import io from 'socket.io-client';

const socket = io("http://192.168.1.227:3000");

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase(); // e.g. "A3BX9K"
}

export default function StartPage() {
  const [name, setName] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const goToRoom = (roomCode: string) => {
    router.push({
      pathname: "/game",
      params: { username: name.trim(), roomCode }
    });
  };

  // Generate a fresh code and go straight in — room is created on join-room
  const handleCreate = () => {
    if (!name.trim()) { setError('Enter a nickname first'); return; }
    const code = generateRoomCode();
    goToRoom(code);
  };

  // Check the room exists on the server before navigating
  const handleJoin = () => {
    if (!name.trim()) { setError('Enter a nickname first'); return; }
    const code = roomInput.trim().toUpperCase();
    if (code.length === 0) { setError('Enter a room code'); return; }

    setLoading(true);
    setError('');

    socket.emit("check-room", code);
    socket.once("room-exists", (exists: boolean) => {
      setLoading(false);
      if (exists) {
        goToRoom(code);
      } else {
        setError(`Room "${code}" not found`);
      }
    });
  };

  return (
    <LinearGradient colors={['#0073df', '#04305a']} style={styles.container}>
      <Text style={styles.title}>Skribbl.io Clone</Text>

      <View style={styles.card}>
        {/* Nickname */}
        <Text style={styles.label}>Nickname</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your nickname"
          value={name}
          onChangeText={(t) => { setName(t); setError(''); }}
          maxLength={20}
        />

        {/* Divider */}
        <View style={styles.divider} />

        {/* Create room */}
        <TouchableOpacity style={styles.btnPrimary} onPress={handleCreate}>
          <Text style={styles.btnText}>🎨  Create New Room</Text>
        </TouchableOpacity>

        {/* Join existing room */}
        <Text style={styles.orText}>— or join existing —</Text>

        <TextInput
          style={styles.input}
          placeholder="Room code (e.g. A3BX9K)"
          value={roomInput}
          onChangeText={(t) => { setRoomInput(t); setError(''); }}
          autoCapitalize="characters"
          maxLength={10}
        />

        {loading
          ? <ActivityIndicator color="#007BFF" style={{ marginTop: 12 }} />
          : (
            <TouchableOpacity style={styles.btnSecondary} onPress={handleJoin}>
              <Text style={styles.btnText}>🚪  Join Room</Text>
            </TouchableOpacity>
          )
        }

        {/* Error */}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerInfo}>
          <Text style={styles.footerText}>Inspired by: Skribbl.io</Text>
          <Text style={styles.footerText}>Tech: React Native, Socket.IO</Text>
        </View>
        <View style={styles.footerInfo}>
          <Text style={styles.footerText}>Simplified version for learning purposes.</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 48, fontWeight: 'bold', color: '#fff', marginBottom: 32 },
  card: {
    width: '90%', maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12,
    elevation: 8,
  },
  label: { fontWeight: 'bold', marginBottom: 6, color: '#333' },
  input: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    padding: 10, marginBottom: 12, fontSize: 15, backgroundColor: '#f9f9f9',
  },
  divider: { borderTopWidth: 1, borderColor: '#eee', marginVertical: 16 },
  btnPrimary: {
    backgroundColor: '#007BFF', borderRadius: 8,
    paddingVertical: 12, alignItems: 'center', marginBottom: 4,
  },
  btnSecondary: {
    backgroundColor: '#28a745', borderRadius: 8,
    paddingVertical: 12, alignItems: 'center', marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  orText: { textAlign: 'center', color: '#999', marginVertical: 12 },
  error: { color: 'red', textAlign: 'center', marginTop: 12, fontSize: 13 },
  footer: {
    position: 'absolute', bottom: 0, flexDirection: 'row',
    width: '100%', height: 60,
  },
  footerInfo: {
    flex: 1, backgroundColor: '#483D8B',
    justifyContent: 'center', alignItems: 'center',
  },
  footerText: { color: '#fff', fontSize: 11 },
});
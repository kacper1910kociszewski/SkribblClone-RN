import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

type EventRow = {
  event: string;
  direction: 'Client -> Server' | 'Server -> Client' | 'Both';
  payload: string;
  note: string;
};

const SOCKET_EVENTS: EventRow[] = [
  {
    event: 'check-room',
    direction: 'Client -> Server',
    payload: '{ roomCode: string }',
    note: 'Checks whether a room has been created before.',
  },
  {
    event: 'room-exists',
    direction: 'Server -> Client',
    payload: '{ exists: boolean }',
    note: 'Returns room existence for join validation.',
  },
  {
    event: 'check-username',
    direction: 'Client -> Server',
    payload: '{ username: string }',
    note: 'Checks if nickname is already active on the server.',
  },
  {
    event: 'username-check-result',
    direction: 'Server -> Client',
    payload: '{ taken: boolean }',
    note: 'Returns nickname availability check result.',
  },
  {
    event: 'join-room',
    direction: 'Client -> Server',
    payload: '{ roomCode: string, username: string }',
    note: 'Joins room and initializes runtime room state.',
  },
  {
    event: 'join-error',
    direction: 'Server -> Client',
    payload: '{ code: string, message: string }',
    note: 'Rejects join when nickname is already taken.',
  },
  {
    event: 'room-state',
    direction: 'Server -> Client',
    payload: '{ players, scores, matchActive, currentRound, maxRounds, drawerSocketId, drawerUsername, phase }',
    note: 'Syncs lobby, scorerboard, match state and drawer info.',
  },
  {
    event: 'start-match',
    direction: 'Client -> Server',
    payload: '{ roomCode: string, maxRounds: number }',
    note: 'Starts a match (default 10 rounds if omitted).',
  },
  {
    event: 'stop-match',
    direction: 'Client -> Server',
    payload: '{ roomCode: string }',
    note: 'Stops current match and emits final standings.',
  },
  {
    event: 'word-options',
    direction: 'Server -> Client',
    payload: 'string[]',
    note: 'Sends word choices to the current drawer.',
  },
  {
    event: 'choose-word',
    direction: 'Client -> Server',
    payload: '{ roomCode: string, word: string }',
    note: 'Drawer picks one word to start drawing phase.',
  },
  {
    event: 'round-start',
    direction: 'Server -> Client',
    payload: '{ displayWord: string }',
    note: 'Starts round; drawer gets full word, others masked word.',
  },
  {
    event: 'timer-update',
    direction: 'Server -> Client',
    payload: '{ phase: waiting|choosing|drawing, secondsLeft: number }',
    note: 'Emits countdown tick during choosing and drawing phases.',
  },
  {
    event: 'mid-draw',
    direction: 'Client -> Server',
    payload: '{ roomCode: string, path: string, color: string, strokeWidth: number, tool: pen|eraser }',
    note: 'Live stroke preview (not persisted).',
  },
  {
    event: 'remote-mid-draw',
    direction: 'Server -> Client',
    payload: '{ path: string, color: string, strokeWidth: number, tool: pen|eraser, userId: string }',
    note: 'Broadcasts the drawer live in-progress styled path.',
  },
  {
    event: 'draw',
    direction: 'Client -> Server',
    payload: '{ roomCode: string, path: string, color: string, strokeWidth: number, tool: pen|eraser }',
    note: 'Finalized stroke; persisted to database.',
  },
  {
    event: 'remote-draw',
    direction: 'Server -> Client',
    payload: '{ path: string, color: string, strokeWidth: number, tool: pen|eraser }',
    note: 'Broadcasts persisted styled stroke to other users.',
  },
  {
    event: 'chat-message',
    direction: 'Client -> Server',
    payload: '{ roomCode: string, username: string, message: string }',
    note: 'Sends chat message or guess attempt.',
  },
  {
    event: 'remote-chat',
    direction: 'Server -> Client',
    payload: '{ username: string, message: string, created_at: string }',
    note: 'Broadcasted chat message, including system messages.',
  },
  {
    event: 'clear-canvas',
    direction: 'Both',
    payload: '{ roomCode: string } / no payload on receive',
    note: 'Drawer clears board and server syncs reset.',
  },
  {
    event: 'round-end',
    direction: 'Server -> Client',
    payload: '{ word: string, winnerUsername, reason, currentRound, maxRounds }',
    note: 'Ends the round after guess or timeout.',
  },
  {
    event: 'match-ended',
    direction: 'Server -> Client',
    payload: '{ reason: round-limit|stopped, standings, winners, currentRound, maxRounds }',
    note: 'Final match results and winner list.',
  },
  {
    event: 'canvas-history',
    direction: 'Server -> Client',
    payload: 'string[]',
    note: 'Sends persisted room strokes on join.',
  },
  {
    event: 'chat-history',
    direction: 'Server -> Client',
    payload: 'ChatMessage[]',
    note: 'Sends the latest persisted chat messages on join.',
  },
];

export default function DocsPage() {
  const router = useRouter();

  return (
    <LinearGradient colors={['#0f4c81', '#0b2d4e']} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={styles.heroBadge}>v1</Text>
          <Text style={styles.heroTitle}>Skribbl Clone API</Text>
          <Text style={styles.heroSubtitle}>
            Interactive real-time game protocol docs inspired by the clean catalog style of PokeAPI docs.
          </Text>
          <View style={styles.baseUrlRow}>
            <Text style={styles.baseUrlLabel}>Socket Base URL</Text>
            <Text style={styles.baseUrlValue}>http://YOUR_LOCAL_IP:3000</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <Text style={styles.paragraph}>
            This project uses Socket.IO instead of REST endpoints. The frontend and backend communicate through
            named events for room management, round flow, drawing sync and chat.
          </Text>
          <Text style={styles.paragraph}>
            Room phases: <Text style={styles.inlineCode}>waiting</Text>, <Text style={styles.inlineCode}>choosing</Text>,{' '}
            <Text style={styles.inlineCode}>drawing</Text>.
          </Text>
          <Text style={styles.paragraph}>
            Match mode includes <Text style={styles.inlineCode}>start-match</Text>, <Text style={styles.inlineCode}>stop-match</Text>,
            scoreboard sync, and round-limit end with standings.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Connection</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeLine}>import io from &apos;socket.io-client&apos;;</Text>
            <Text style={styles.codeLine}>const socket = io(&apos;http://YOUR_LOCAL_IP:3000&apos;);</Text>
          </View>
          <Text style={styles.paragraph}>
            Use your machine local network IP when testing on real mobile devices.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Socket Events</Text>
          {SOCKET_EVENTS.map((item) => (
            <View key={`${item.event}-${item.direction}`} style={styles.eventRow}>
              <View style={styles.eventHeader}>
                <Text style={styles.eventName}>{item.event}</Text>
                <Text style={styles.eventDirection}>{item.direction}</Text>
              </View>
              <Text style={styles.eventPayload}>Payload: {item.payload}</Text>
              <Text style={styles.eventNote}>{item.note}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Database Tables</Text>
          <Text style={styles.paragraph}>rooms(code, created_at)</Text>
          <Text style={styles.paragraph}>strokes(id, room_code, path, created_at)</Text>
          <Text style={styles.paragraph}>chat_messages(id, room_code, username, message, created_at)</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Environment Variables</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeLine}>DB_HOST=localhost</Text>
            <Text style={styles.codeLine}>DB_USER=skribbl_user</Text>
            <Text style={styles.codeLine}>DB_PASSWORD=yourpassword</Text>
            <Text style={styles.codeLine}>DB_NAME=skribbl</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Back to Menu</Text>
        </TouchableOpacity>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },
  heroCard: {
    backgroundColor: '#f7f9fc',
    borderRadius: 16,
    padding: 18,
    borderWidth: 2,
    borderColor: '#ffcb05',
    marginBottom: 14,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffcb05',
    color: '#0b2d4e',
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 100,
    marginBottom: 8,
  },
  heroTitle: { fontSize: 30, color: '#0b2d4e', fontWeight: '800' },
  heroSubtitle: { fontSize: 14, color: '#1b4871', marginTop: 8, lineHeight: 20 },
  baseUrlRow: {
    marginTop: 14,
    backgroundColor: '#0b2d4e',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  baseUrlLabel: { color: '#b9d8f2', fontSize: 12, marginBottom: 3 },
  baseUrlValue: { color: '#ffcb05', fontSize: 14, fontWeight: '700' },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0e3a63',
    marginBottom: 10,
  },
  paragraph: { color: '#214d76', lineHeight: 20, marginBottom: 7 },
  inlineCode: { color: '#0b2d4e', fontWeight: '700' },
  codeBlock: {
    backgroundColor: '#f2f7ff',
    borderWidth: 1,
    borderColor: '#d6e7fb',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  codeLine: { color: '#164267', fontFamily: 'Courier', fontSize: 13, marginBottom: 2 },
  eventRow: {
    borderWidth: 1,
    borderColor: '#dbe8f7',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#fbfdff',
  },
  eventHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, gap: 8 },
  eventName: { color: '#0b2d4e', fontWeight: '800', fontSize: 14 },
  eventDirection: { color: '#0d66aa', fontWeight: '700', fontSize: 12 },
  eventPayload: { color: '#20496f', fontSize: 12, marginBottom: 2 },
  eventNote: { color: '#3f678c', fontSize: 12, lineHeight: 17 },
  backButton: {
    marginTop: 8,
    alignSelf: 'center',
    backgroundColor: '#ffcb05',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  backButtonText: { color: '#0b2d4e', fontWeight: '800' },
});

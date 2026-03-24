import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function StartPage() {
  const [name, setName] = useState('')
  const router = useRouter()


  ///=================================================\
  //|     Name Checking + Joining Logic with Push     |
  //\=================================================/
  const handleJoin = () => {
    if (name.trim().length > 0) {
      // This pushes the user to app/game.tsx
      router.push({
        pathname: "/game",
        params: { username: name, roomCode: "123" } // Default room for now
      });
    }
  };

///==================================\
//|            RENDER                |
//\==================================/
  return (
    <LinearGradient
      colors={['#0073df', '#04305a']}
      style={styles.container}
    >
      <Text style={styles.title}>Skribbl.io COPY</Text>
      <View style={styles.nameBox}>
        <TextInput
          style={styles.input}
          placeholder="Enter your nickname"
          value={name}
          onChangeText={setName}
        />
        <TouchableOpacity style={styles.button} onPress={handleJoin}>
          <Text style={styles.buttonText}>Play</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.footer}>
        <View style={styles.footerInfo}>
          <Text>Inspired by: Skribbl.io</Text>
          <Text>Tech: React Native, Socket.IO</Text>
        </View>
        <View style={styles.footerInfo}>
          <Text>Note: This is a simplified version for learning purposes.</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

///==================================\
//|            STYLES                |
//\==================================/
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center'
  },
  nameBox: {
    width: '50%',
    backgroundColor: 'blue',
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: '#fff',
    borderWidth: 2,
    borderRadius: 10,
  },
  footer: {
    height: '15vh',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    position: 'absolute',
    bottom: 0,
    fontSize: 12,
    color: '#fff',
  },
  footerInfo: {
    display: 'flex', 
    flexDirection: 'column', 
    justifyContent: "center", 
    alignItems: 'center' , 
    backgroundColor: '#483D8B', 
    width: "33.33vw",
  },
  title: {
    fontSize: 64,
    marginBottom: 30,
    fontWeight: 'bold',
  },
  input: {
    width: '80%',
    padding: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#007BFF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
  },
});
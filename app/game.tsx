import React, { useState } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export default function GameSession() {
  const [currentPath, setCurrentPath] = useState('')
  const [paths, setPaths] = useState<string[]>([])

  ///=================================================\
  //|      Drawing Logic: Touch & Gesture Handling    |
  //\=================================================/
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // Get initial touch point and start the SVG Path (M = Move To)
    onPanResponderGrant: (evt) => {
      const { locationX, locationY } = evt.nativeEvent
      setCurrentPath(`M${locationX},${locationY}`)
    },
    onPanResponderMove: (evt) => {
    // Continue the line as the finger moves (L = Line To)
      const { locationX, locationY } = evt.nativeEvent
      setCurrentPath((prev) => `${prev} L${locationX},${locationY}`)
    },
    onPanResponderRelease: () => {
    // Finger lifted: Save the current stroke to the permanent paths array
      if (currentPath) {
        setPaths((prev) => [...prev, currentPath])
        setCurrentPath('');
      }
    },
  });


///==================================\
//|            RENDER                |
//\==================================/
  return (
    <View style={styles.container}>
      <View style={styles.canvas} {...panResponder.panHandlers}>
        <Svg style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke="black" strokeWidth={3} fill="none" strokeLinecap="round" />
          ))}
          {currentPath ? (
            <Path d={currentPath} stroke="blue" strokeWidth={3} fill="none" strokeLinecap="round" />
          ) : null}
        </Svg>
      </View>
    </View>
  );
}


///==================================\
//|            STYLES                |
//\==================================/
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#222' },
  canvas: { 
    width: '90%', 
    aspectRatio: 1, 
    backgroundColor: 'white', 
    borderRadius: 10, 
    overflow: 'hidden' 
  },
});
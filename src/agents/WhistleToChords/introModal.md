# Whistle to Chords

This is a basic agent to demonstrate the audio-input capabilities of Euterpe. It uses Meyda to estimate rms, chroma features and extract pitch from the audio input and then generates chords based on a simple rule based algorithm.

## Instructions
The system works better when you whistle instead of singing as whistling is more likely to produce a sharper peak in the chroma vector. The pitch is estimated by choosing the pitch in the chroma vector with the maximum value, but only when that value is above a certain threshold compared to the rest of the chroma vector.
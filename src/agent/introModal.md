# Gridy Copycat

This is a simple musical agent that mimics the user's input. It is very similar to the **Copycat** agent, but it is based on a 16th-note grid interaction. This means that the agent mimics the 16th-note quantized version of your input. The agent is also limited to a monophonic response. Contrary to the **Copycat** agent, this interaction utilizes the real-time Score notation. 

## Settings
Similarly to **Copycat** we provide 3 sliders to control the interaction.

- **Randomness**: Controls the randomness of the copycat. With a slider value of 0, the agent mimics the user precisely, but as the randomness value increases, the mimicry becomes less precise.

- **Delay**: Controls the delay of the copycat's response. Here, the delay is measured in 16th notes, and contrary to the **Copycat**, the smallest delay is `1` (16th note), due to the quantization step.

- **PitchShift**: This slider will control the note distance between the user's input and the copycat's response. With a slider value of 0, the agent mimics the user 1 octave lower, but as the pitchShift value increases, the copycat's response becomes higher in pitch.


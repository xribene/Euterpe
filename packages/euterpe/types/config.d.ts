// Generated from schema/*.schema.json by scripts/gen-config-types.mjs. Do not edit.

/**
 * How the agent interacts: note or audio input, grid (clock) or event mode, and the clock.
 */
export interface ConfigYaml {
  /**
   * The system's name, shown on the start screen.
   */
  title?: string;
  subtitle?: string;
  interactionMode: {
    /**
     * The user plays notes (laptop keyboard, MIDI keyboard, on-screen keyboard).
     */
    noteMode?: boolean;
    /**
     * The agent gets the microphone: processAudioBuffer is called for every frame.
     */
    audioMode?: boolean;
    /**
     * The agent plays audio it generates: ctx.audioOut.write(), the renderAudio hook, or {audio} in a hook's return value.
     */
    audioOut?: boolean;
  };
  noteModeSettings: {
    eventBased?: {
      /**
       * processNoteEvent is called for every user note, as it happens.
       */
      status?: boolean;
    };
    gridBased?: {
      /**
       * processClockEvent is called on every clock tick.
       */
      status?: boolean;
      /**
       * The clock event carries userNotes: every user note since the last tick.
       */
      eventBuffer?: boolean;
      /**
       * The clock event carries userQuantizedNotes: the user's notes on this tick, aligned to the grid.
       */
      quantizedEvents?: boolean;
      polyphony?: {
        /**
         * At most this many simultaneous user notes in userQuantizedNotes.
         */
        input?: number;
      };
      /**
       * Run the agent a quarter tick after the tick, to catch notes played slightly late (better score alignment).
       */
      delayedExecution?: boolean;
    };
  };
  audioModeSettings?: {
    /**
     * Samples per frame passed to processAudioBuffer (at audioModeSettings.sampleRate). Default 1024.
     */
    windowSize?: number;
    /**
     * Samples between consecutive frames: at most windowSize; default windowSize (no overlap).
     */
    hopSize?: number;
    /**
     * The agent's input sample rate: frames are resampled to it (e.g. 16000 for a speech-rate model). Default: the page's (44100 or 48000, set by the device).
     */
    sampleRate?: number;
    /**
     * The browser's echo cancellation on the microphone. Default false (it distorts music).
     */
    echoCancellation?: boolean;
    /**
     * The browser's noise suppression. Default false (it removes sustained tones).
     */
    noiseSuppression?: boolean;
    /**
     * The browser's automatic gain control. Default false (it pumps the level).
     */
    autoGainControl?: boolean;
  };
  /**
   * The agent's audio output (interactionMode.audioOut).
   */
  audioOutSettings?: {
    /**
     * 1: mono (played on both speakers), 2: stereo. Default 2.
     */
    channels?: 1 | 2;
    /**
     * Seconds of audio kept queued ahead of playback (renderAudio fills up to this). More: fewer dropouts, later sound. Default 0.1.
     */
    latency?: number;
    /**
     * The agent's output sample rate: renderAudio / ctx.audioOut.write take audio at this rate and Euterpe resamples it. Default: the page's.
     */
    sampleRate?: number;
    /**
     * renderAudio is always asked for exactly this many frames (for models with a fixed block size). Default: variable, in steps of 128.
     */
    blockSize?: number;
  };
  clockSettings: {
    /**
     * Start the clock when the user presses the start button.
     */
    autoStart?: boolean;
    /**
     * 4: a 16th-note grid in 4/4.
     */
    ticksPerBeat: number;
    timeSignature?: {
      numerator?: number;
      denominator?: 1 | 2 | 4 | 8 | 16 | 32;
    };
    defaultBPM?: number;
    /**
     * A fixed tick period in ms (free time); null to use BPM and ticksPerBeat.
     */
    clockPeriod?: number | null;
  };
  agentSettings?: {
    warmupRounds?: number;
  };
  /**
   * Show agent/intro.md when the page opens.
   */
  introModal?: boolean;
  /**
   * Ignored: the intro is agent/intro.md.
   */
  introModalMarkdown?: string;
  custom?: {
    useTriggerRelease?: boolean;
  };
}

/**
 * What the UI shows, and the agent's controls in Settings (read in hooks as ctx.params).
 */
export interface WidgetsYaml {
  gui: {
    score: Status;
    /**
     * Shows the agent's text/label output.
     */
    textBox: {
      status?: boolean;
      title?: string;
    };
    pianoRoll: {
      status?: boolean;
      human?: boolean;
      agent?: boolean;
    };
    keyboard: {
      status?: boolean;
      octaveStart?: number;
      octaveEnd?: number;
    };
    chromaChart: Status1;
    audioMeter: Status2;
    /**
     * Live canvas (grid mode): the user draws a line with the mouse and taps a key for rhythm; the agent turns the line into the user's notes (messageType.HUMAN_TOKEN, ctx.liveCanvas). Used by apps/bachduet.
     */
    liveCanvas?: {
      status?: boolean;
      /**
       * Mouse pixels per semitone (vertical movement only). Default 20.
       */
      sensitivity?: number;
      /**
       * The line's range in semitones, [low, high]. Default [0, 24].
       *
       * @minItems 2
       * @maxItems 2
       */
      range?: [number, number];
      /**
       * The key held for rhythm (KeyboardEvent.key; not Space). Default 'f'.
       */
      tapKey?: string;
      /**
       * On key release: the model's rhythm takes over (default), or the note stops.
       */
      tapRelease?: "model" | "off";
      /**
       * Drawing mode off: hold the note (default), rest, or let the model play on without the curve.
       */
      penUp?: "hold" | "rest" | "free";
      /**
       * Curve to melody: 'rules' (nearest scale note) or 'onnx' (the Draw & Listen duet model). Switchable on the canvas.
       */
      model?: "rules" | "onnx";
      /**
       * Where duet.onnx and duet_constants.json are served. Default /models/drawlisten.
       */
      modelDir?: string;
      /**
       * The model's window in ticks. Default 64.
       */
      window?: number;
      /**
       * The canvas voice plays from the start. Default true.
       */
      armed?: boolean;
      /**
       * The canvas is shown from the start (default true); false: hidden until Settings' "Draw your part" is ticked.
       */
      visible?: boolean;
      width?: number;
      height?: number;
      /**
       * Ticks of the past shown left of the now marker. Default 48.
       */
      ticksShown?: number;
      /**
       * Rules (and the drawing): the MIDI note at the bottom of the range. Default 60.
       */
      baseMidi?: number;
      /**
       * Rules: new notes only on multiples of this many ticks. Default 2 (8th notes).
       */
      density?: number;
      /**
       * Rules: semitones the line must be nearer a new note than the current one. Default 0.4.
       */
      hysteresis?: number;
      /**
       * ONNX: follow strength w. 1 (default) = the model as trained; otherwise it runs twice per tick and uses uncond + w * (cond - uncond).
       */
      follow?: number;
      /**
       * ONNX: the pitch is sampled from pitch[dir] without restricting it to the direction bin.
       */
      softDirection?: boolean;
      /**
       * ONNX: pitches only from the current key's scale (the agent's key estimate).
       */
      inKey?: boolean;
    };
    monitor?: {
      status?: boolean;
      title?: string;
      structure?:
        | {
            label: string;
            parameters: {
              /**
               * The id the agent writes with ctx.monitor(id, value).
               */
              id: number;
              label: string;
              interval?: number;
              graph?: boolean;
              min?: number;
              max?: number;
            }[];
          }[]
        | null;
    };
    settingsModal?: {
      /**
       * ctx.params.slider[id].
       *
       * @maxItems 6
       */
      sliders?:
        | []
        | [
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              /**
               * ctx.params.slider[id] (default: the slider's position).
               */
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | null;
      /**
       * ctx.params.switch[id].
       *
       * @maxItems 4
       */
      switches?:
        | []
        | [
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            }
          ]
        | [
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            }
          ]
        | [
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            }
          ]
        | [
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              /**
               * ctx.params.switch[id] (default: the switch's position).
               */
              id?: number;
              label: string;
              status?: boolean;
            }
          ]
        | null;
      /**
       * ctx.params.button[id]: how many times it was pressed.
       *
       * @maxItems 4
       */
      buttons?:
        | []
        | [
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * Also restart the bar: the next tick is beat 1, and the agent gets clock.barReset.
               */
              resetsClock?: boolean;
            }
          ]
        | null;
      /**
       * ctx.params.dropdown[id]: the index of the selected option.
       *
       * @maxItems 4
       */
      dropdowns?:
        | []
        | [
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            },
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            },
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            },
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            },
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            },
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            },
            {
              id: number;
              label: string;
              /**
               * @minItems 1
               */
              options: [string, ...string[]];
              value?: number;
              /**
               * Also show this dropdown on the start screen.
               */
              intro?: boolean;
              /**
               * A short explanation shown under this dropdown in Settings.
               */
              note?: string;
            }
          ]
        | null;
      dropdownsNote?: string;
      /**
       * ctx.params.text[id]: the field's text. The agent gets it when the user presses Enter or leaves the field (updateParameter with kind 'text').
       *
       * @maxItems 4
       */
      textFields?:
        | []
        | [
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            }
          ]
        | [
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            },
            {
              id: number;
              label: string;
              /**
               * The initial text.
               */
              value?: string;
              placeholder?: string;
              /**
               * Also show this field on the start screen.
               */
              intro?: boolean;
            }
          ]
        | null;
    };
  };
}
/**
 * Staff notation of the user (treble) and the agent (bass). Monophonic.
 */
export interface Status {
  status?: boolean;
}
/**
 * Shows the agent's vector output (audio mode).
 */
export interface Status1 {
  status?: boolean;
}
/**
 * Microphone level (audio mode).
 */
export interface Status2 {
  status?: boolean;
}

/**
 * The players (human, agent, metronome), their instruments and mixer settings.
 */
export interface PlayersYaml {
  players: {
    human: Player;
    agent: Player;
    metronome?: Player;
  };
}
export interface Player {
  label: string;
  mute?: boolean;
  volume?: number;
  /**
   * @minItems 1
   */
  instruments: [
    {
      /**
       * The sampler (or 'synth', an FM synth).
       */
      id: "piano" | "drums" | "upright_bass" | "click" | "synth";
      label?: string;
      mute?: boolean;
      volume?: number;
      default?: boolean;
    },
    ...{
      /**
       * The sampler (or 'synth', an FM synth).
       */
      id: "piano" | "drums" | "upright_bass" | "click" | "synth";
      label?: string;
      mute?: boolean;
      volume?: number;
      default?: boolean;
    }[]
  ];
}

/** The agent's configuration: config.yaml, players.yaml and widgets.yaml merged (ctx.config). */
export type Config = ConfigYaml & PlayersYaml & WidgetsYaml;

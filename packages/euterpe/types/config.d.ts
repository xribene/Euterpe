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
     * Samples per frame passed to processAudioBuffer.
     */
    windowSize?: number;
    /**
     * Samples between consecutive frames.
     */
    hopSize?: number;
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
       * ctx.params.slider[n]: n is the slider's position (1-based).
       *
       * @maxItems 6
       */
      sliders?:
        | []
        | [
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | [
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            },
            {
              id?: number;
              label: string;
              value: number;
              min: number;
              max: number;
            }
          ]
        | null;
      /**
       * ctx.params.switch[n]: n is the switch's position (1-based).
       *
       * @maxItems 4
       */
      switches?:
        | []
        | [
            {
              id?: number;
              label: string;
              status?: boolean;
            }
          ]
        | [
            {
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              id?: number;
              label: string;
              status?: boolean;
            }
          ]
        | [
            {
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              id?: number;
              label: string;
              status?: boolean;
            }
          ]
        | [
            {
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              id?: number;
              label: string;
              status?: boolean;
            },
            {
              id?: number;
              label: string;
              status?: boolean;
            },
            {
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
            }
          ]
        | null;
      dropdownsNote?: string;
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

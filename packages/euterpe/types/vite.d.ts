import type {Plugin} from 'vite';

export interface EuterpeOptions {
    /** The agent's folder, relative to the project root. Default 'agent'. */
    agentDir?: string;
    /**
     * Where the instrument samples are served from (e.g. a CDN). By default the plugin serves the samples that
     * ship with Euterpe and copies them into the build.
     */
    samplesBaseUrl?: string;
}

/** The Vite plugin of a Euterpe project: `plugins: [euterpe()]`. */
export default function euterpe(options?: EuterpeOptions): Plugin[];

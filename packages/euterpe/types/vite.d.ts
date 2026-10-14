import type {Plugin} from 'vite';

export interface EuterpeOptions {
    /** The agent's folder, relative to the project root. Default 'agent'. */
    agentDir?: string;
    /**
     * Other files to use instead of the agent folder's, relative to the project root: e.g. two builds of one
     * agent with different widgets (`files: {widgets: 'agent/widgets.official.yaml'}`).
     */
    files?: {hooks?: string; config?: string; widgets?: string; players?: string; intro?: string};
    /**
     * Where the instrument samples are served from (e.g. a CDN). By default the plugin serves the samples that
     * ship with Euterpe and copies them into the build.
     */
    samplesBaseUrl?: string;
}

/** The Vite plugin of a Euterpe project: `plugins: [euterpe()]`. */
export default function euterpe(options?: EuterpeOptions): Plugin[];

<div align="center">
    <h1>Euterpe</h1>
    <img src="public/img/heroImage.svg" style="filter: drop-shadow(0px 1px 0px Grey);" alt="Hero Image" width="500" height="200">
</div>

Euterpe is a framework designed to bridge the gap between music interaction and creation research and its deployment into user-friendly systems accessible to the general public on the web. Euterpe aims to be a template or starting point, from which you can develop your own music interaction system.

## Deployed Systems Using Euterpe
- [BachDuet](https://bachduet-euterpe.netlify.app/)
- [PianoGenie](https://piano-genie-euterpe.netlify.app/)
- [Copycat](https://copycat-euterpe.netlify.app/)
- [GridyCopycat](https://gridy-copycat-euterpe.netlify.app/)
- [CallAndResponse](https://call-response-euterpe.netlify.app/)
- [Whistle-2-Chords](https://whistle2chords-euterpe.netlify.app/)
- [JazzTrio](https://jazz-improv-pilot.netlify.app/)


---
## Installation

### Node.js

If you don't have node.js installed, we recommend using the Node environment manager NVM. If you already have node.js installed but it is older than v16, we suggest you install a newer one.

In your terminal, you can check if you have Node.js or NVM installed by running

```bash
# For NVM
nvm -v
# For Node
node -v
```

Based on that, you can follow one of the options below

- Install Node.js using NVM
  1. Installing NVM
     Instructions for [MacOS](https://catalins.tech/node-version-manager-macos/), [Linux](https://github.com/nvm-sh/nvm#installing-and-updating) and [Windows](https://github.com/coreybutler/nvm-windows#installation--upgrades)
  2. Installing Node
     ```bash
     nvm install v21.1.0
     nvm use 21.1.0
     # verify that Node.js is correctly installed:
     node -v
     ```
- Install Node.js without NVM
  1. Choose the correct pre-build [installers](https://nodejs.org/en/download) for your platform
  2. Or use some other package manager that your platform provides (i.e Homebrew for macOS)

### Euterpe

Now that you have Node.js set up, you can proceed to install Euterpe by following these steps:

- Getting the source code

  ```bash
  git clone https://github.com/xribene/Euterpe.git
  ```

- Installing dependencies

    ```bash
    # Navigate to the Euterpe folder
    cd Euterpe
    # Install the package manager pnpm
    npm install -g pnpm
    # Use pnpm to install all dependencies
    pnpm install
    ```


---
## Run Euterpe examples

To confirm everything was installed correctly run the following command from the Euterpe directory:

```bash
pnpm run dev
```

If successful, this command will start a local development server on port `5173`.
Visit [http://localhost:5173](http://localhost:5173) and try the deployed web-app.

---
## Deployment

When you are ready to deploy Euterpe, you can run the following command in the root directory of the project:
```sh
pnpm run build
```

This will by default generate a `dist` folder in the root directory of the project. You can then deploy the contents of the `dist` folder to your web server.

---
## Made with 
- [Vue.js](https://vuejs.org/)
- [WebAudio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Tone.js](https://tonejs.github.io/)
- [ringbuf.js](https://github.com/padenot/ringbuf.js/)
- [tonaljs](https://tonaljs.github.io/tonal/docs/)
- [audiokeys](https://github.com/kylestetz/AudioKeys)
- [vexflow](https://www.vexflow.com/)
- [three.js](https://threejs.org/)
- [vue-chartjs](https://vue-chartjs.org/)
- [tweakpane](https://tweakpane.github.io/docs/)




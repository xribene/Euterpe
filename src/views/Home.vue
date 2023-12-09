<template>
    <div class="full-container">
        <h1>Audio Agents Demo</h1>
        <p>12/08/23 Euterpe</p>
        <div class="app-container">
            <button v-on:click="goToLink('/bachduet')" class="app-button">
                <h3>BachDuet</h3>
                <span>Trained on Bach Chorales<br />Can jam with you in real-time</span>
            </button>
            <button v-on:click="goToLink('/pianogenie')" class="app-button">
                <h3>PianoGenie</h3>
                <span>Use a 8-button keyboard<br />To play an 88-key piano</span>
            </button>
        </div>
    </div>
</template>
  
<script>
export default {
    methods: {
        goToLink(path) {
            window.location.href = `${window.location.origin}${path}`;
        },
    },
};
</script>
  
<style>
body,
html {
    background-color: #f0f0f0;
    color: black;
    font-family: 'Courier New', Courier, monospace;
}

.full-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: 'Courier New', Courier, monospace;
    color:black;
}

.app-container {
    display: flex;
    justify-content: center;
    align-items: center;
}

.app-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 300px;
    height: 300px;
    margin: 10px;
    border: none;
    border-radius: 10px;
    background-color: #ffffff;
    box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.2);
    font-family: 'Courier New', Courier, monospace;
    font-size: 14px;
    cursor: pointer;
}

.app-button img {
    width: 60px;
    height: 60px;
    margin-bottom: 10px;
}

.app-button span {
    color: #333333;
}
</style>
  
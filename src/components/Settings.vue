<template>
    <div>
        <modal name="settingsModal" :minWidth=700 :minHeight=600 :adaptive="true">
            <div class="settingsContainer">
                <div class="settingsHeader">
                    <p class="settingsTitle">
                        Settings
                    </p>
                    <button class="settingsBtn" @click="$modal.hide('settingsModal')">
                        <md-icon class="settingsIcon"
                            style="padding:0;margin:0;height:24px">close</md-icon>
                    </button>
                </div>
                <div class="settingsContent" style="overflow-y: scroll; height:600px">
                    <div id="ClockSection" class="settingsBorderedTitle"
                        style="display:flex;justify-content:start;align-items:center">
                        <p class="settingsSubtitle" style="padding:0; margin-right:50px">
                            <md-icon class="settingsIcon">history_toggle_off</md-icon> <br />
                            <span style="line-height:36px">Clock</span>
                        </p>
                        <div class="settingsDiv">
                            <p class="settingsOptionTitle">BPM (Max: {{ maxBPM }})</p>
                            <div style="padding-top: 14px">
                                <BPMSlider v-model="currentBPM" :min="60" :max="120"
                                            @bpmChangeEvent="bpmValueChanged"/>
                            </div>
                        </div>
                    </div>

                    <div id="MIDISection" style="display:flex;
                            justify-content:start;align-items:center;margin-top:30px">
                        <p class="settingsSubtitle settingsBorderedTitle" style="padding:0">
                            <md-icon class="settingsIcon" style="font-weight:400">piano
                            </md-icon> <br />
                            <span style="line-height:36px">MIDI</span>
                        </p>
                        <div class="MIDIInput" style="padding-left: 8px" v-if="WebMIDISupport">
                            <!-- <Dropdown :options="activeDevices"
                                v-on:selected="onMIDIDeviceSelectedChange"
                                placeholder="MIDI Input Device"
                                v-model="selectedMIDIInputDevice"
                                >
                            </Dropdown> -->
                            <!-- Output Device Selection -->
                            <!-- <Dropdown 
                                :options="activeMidiOutputDevices"
                                v-on:selected="onMIDIOutputDeviceSelectedChange"
                                placeholder="MIDI Output Device"
                                v-model="selectedMIDIOutputDevice"
                                >
                            </Dropdown> -->
                            <div class="dropdown-container">
                                <label for="midi-input">Input Device</label>
                                <select id="midi-input" v-model="selectedMIDIInputDevice" @change="onMIDIDeviceSelectedChange">
                                    <!-- <option value="None" disabled>Input Device</option> -->
                                    <option v-for="device in activeDevices" :key="device.id" :value="device.id">
                                        {{ device.name }}
                                    </option>
                                </select>
                            </div>

                            <div class="dropdown-container">
                                <label for="midi-output">Output Device</label>
                                <select id="midi-output" v-model="selectedMIDIOutputDevice" @change="onMIDIOutputDeviceSelectedChange">
                                    <!-- <option value="None" disabled>Output Device</option> -->
                                    <option v-for="device in activeMidiOutputDevices" :key="device.id" :value="device.id">
                                        {{ device.name }}
                                    </option>
                                </select>
                            </div>
                        </div>
                        <span v-else>
                            Currently, Using MIDI devices in browser is only supported by Google
                            Chrome v43+, Opera v30+ and Microsoft Edge v79+. Please update to
                            one of those browsers if you want to use Web MIDI
                            functionalities.</span>
                    </div>
                    <!-- <modal name="settingsModal" :minWidth="700" :minHeight="600" :adaptive="true"> -->
                    <div style="display: flex; flex-direction:column;">
                        <p class="settingsAgentSubtitle">Agent Parameters</p>
                        <!-- Sliders for agent Parameters -->
                        <div class="agentParametersContainer">
                            <div v-if="sliders.length > 0" class="controlCollection">
                                <div v-for="sliderItem in sliders" :key="'slider' + sliderItem.id">
                                    <Slider
                                        v-model="sliderItem.value"
                                        :min="sliderItem.min"
                                        :max=sliderItem.max
                                        :label="sliderItem.label"
                                    />
                                </div>
                            </div>

                            <!-- Buttons for agent Parameters -->
                            <div v-if="buttons.length > 0" class="controlCollection">
                                <div v-for="buttonItem in buttons" :key="'button' + buttonItem.id">
                                    <button class="agentParameterButton"
                                        @click="buttonAction(buttonItem.id)">
                                        <!-- <span class="forceTextColor">{{ buttonItem.label }}
                                        </span> -->
                                        {{ buttonItem.label }}
                                    </button>
                                </div>
                            </div>
                            <!-- Switches for agent Parameters -->
                            <div v-if="switches.length > 0" class="controlCollection">
                                <div class="switchContainer" v-for="swi in switches" :key="'switch' + swi.id">
                                    <div class="switchLabel">{{ swi.label }}</div>
                                    <toggle-button class="switch"
                                        color="#e6a100"
                                        v-model="swi.status"
                                        />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </modal>
    </div>
</template>

<script>
// import HorizontalSlider from './HorizontalSlider.vue';
import Slider from './Slider.vue'
import BPMSlider from './BPMSlider.vue';
import Dropdown from 'vue-simple-search-dropdown';

export default {
    name: 'SettingsModal',
    components: {
        // HorizontalSlider,
        Slider,
        BPMSlider,
        Dropdown
    },
    props: {
        sliders: {
            type: Array,
            default: () => [],
        },
        buttons: {
            type: Array,
            default: () => [],
        },
        switches: {
            type: Array,
            default: () => [],
        },
        activeDevices: {
            type: Array,
            default: () => [],
        },
        activeMidiOutputDevices: {
            type: Array,
            default: () => [],
        },
        WebMIDISupport: {
            type: Boolean,
            default: false,
        },
        maxBPM: Number,
        initBPM: Number
    },

    data() {
        return {
            currentBPM: this.$props.initBPM,
            selectedMIDIInputDevice: 1123581321, // id for "None" option 
            selectedMIDIOutputDevice: 1123581321 // id for "None" option
        };
    },

    // TODO: Use the sortedCollection to render the controls in the correct order
    computed: {
        sortedCollections() {
            const collections = [
                { type: "sliders", items: this.sliders, component: "Slider", props: {} },
                { type: "buttons", items: this.buttons, component: "button", props: {} },
                { type: "switches", items: this.switches, component: "ToggleButton", props: { color: "#e6a100" } },
            ];
            return collections.sort((a, b) => b.items.length - a.items.length);
        },
    },

    methods: {
        buttonAction(id) {
            // Emit an event to notify the parent about the button action
            this.$emit('button-click', id);
        },
        onMIDIDeviceSelectedChange(device) {
            // Emit an event to notify the parent about the MIDI device change
            this.$emit('midi-device-change', device);
        },
        onMIDIOutputDeviceSelectedChange(device) {
            // Emit an event to notify the parent about the MIDI output device change
            this.$emit('midi-output-device-change', device);
        },
        bpmValueChanged(bpm) {
            // Emit an event to notify the parent about the BPM change
            this.$emit('bpm-change', bpm);
        },
    },

};
</script>


<style scoped>

.dropdown-container {
    display: inline-block;
    margin-right: 20px; /* Add space between the dropdowns */
    vertical-align: top;
}

.dropdown-container label {
    display: block;
    margin-bottom: 5px; /* Space between label and select */
    /* font-weight: bold; */
    font-size: medium;
}

select {
    width: 200px; /* Adjust width as needed */
    padding: 5px;
    font-size: 14px;
    margin-bottom: 10px;
}

.settingsContainer {
    display: flex;
    flex-direction: column;
    height: 600px;
}

.settingsTitle {
    font-size: 30px;
    padding-left: 2%;
    font-weight: 800;
    color: var(--button-background-color);
    font-family: roboto;
}
.settingsHeader {
    flex: 1;
    flex-basis: 10%;
    z-index: 999;
    margin: 0;
    background: var(--grey-background-color);
    color: var(--text-color);
    align-items: center;
    box-shadow: 0 0 10px 0 var(--background-color);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
    font-family: roboto;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.settingsSubtitle {
    margin: 0;
    font-weight: 800;
    font-size: 24px;
    padding-top: 30px;
    padding-bottom: 0px;
}

.agentParametersContainer {
    display: flex;
    flex-direction: row;
}

.controlCollection {
    flex: 1;
    flex-basis: 33%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-right: 1px dashed var(--foreground-color);
    text-align: center;
}
.settingsAgentSubtitle {
    margin: 0;
    font-weight: 800;
    font-size: 24px;
    padding-top: 30px;
    padding-bottom: 30px;
}

.settingsDiv {
    height: 70px;
    padding-top: 5px;
    padding-bottom: 5px;
    color: var(--text-color);
}

.settingsOptionTitle {
    margin: 0;
    font-weight: 800;
    font-size: 20px;
}

.settingsBorderedTitle {
    border-right: 1px dashed var(--foreground-color);
    width: 100px;
}

.settingsBtn {
    background-color: rgba(0, 0, 0, 0);
    border: none;
    height: 100%;
    float: right;
}

.settingsIcon {
    height: 100%;
    padding: 0!important;
    margin: 0!important;
    display: inline-block;
    color: var(--text-color)!important;
}

.settingsContent {
    flex: 1;
    flex-basis: 90%;
    background-color: var(--grey-background-color);
    color: var(--text-color);
    font-size: 25px;
    font-family: roboto;
    overflow-y: scroll;
    padding-left: 2%;
    padding-top: 2%;
}

.slider {
    writing-mode: bt-lr;
    /* -webkit-appearance: slider-horizontal; */
    width: 200px;
    height: 20px;
    padding: 0;
    margin: 0;
    background: #d3d3d3;
    outline: none;
    opacity: 0.7;
    -webkit-transition: .2s;
    transition: opacity .2s;
}


.agentParameterButton {
    background-color: var(--grey-background-color);
    border-radius: 8px;
    width: 50%;
    color: var(--button-background-color);
    font-size: 20px;
    box-shadow: 0 0 10px 0 var(--background-color);
}

.agentParameterButton:hover {
    background-color: var(--button-background-color);
    border-radius: 8px;
    width: 50%;
    color: var(--grey-background-color);
    font-size: 20px;
}

.switchContainer {
    display: flex;
    flex-direction: row;
    align-items: center;
    align-content: center;
    border-right: 1px dashed var(--foreground-color);
    width: 100%;
    text-align: center;
}

.switchLabel {
    flex: 1;
    flex-basis: 50%;
    align-content: center;
    text-align: center;
}

.switch {
    flex: 1;
    flex-basis: 50%;
    align-content: center;
    text-align: center;
}

</style>


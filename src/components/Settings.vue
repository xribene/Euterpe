<template>
    <div>
        <modal name="settingsModal" :minWidth=700 :minHeight=600 :adaptive="true">
            <div style="padding:0; margin: 0; ">
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
                        <div class="md-layout md-gutter md-alignment-left settingsBordered">
                            <div class="md-layout-item md-small-size-50 md-xsmall-size-100">
                                <div class="settingsDiv">
                                    <p class="settingsOptionTitle">BPM (Max: {{ maxBPM }})</p>
                                    <div style="padding-top: 14px">
                                        <BPMSlider v-model="currentBPM" :min="60" :max="120"
                                                    @bpmChangeEvent="bpmValueChanged"/>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="MIDISection" style="display:flex;
                            justify-content:start;align-items:center;margin-top:50px">
                        <p class="settingsSubtitle settingsBorderedTitle" style="padding:0">
                            <md-icon class="settingsIcon" style="font-weight:400">piano
                            </md-icon> <br />
                            <span style="line-height:36px">MIDI</span>
                        </p>
                        <div class="MIDIInput" style="padding-left: 8px" v-if="WebMIDISupport">
                            <Dropdown :options="activeDevices"
                                v-on:selected="onMIDIDeviceSelectedChange"
                                placeholder="Type here to search for MIDI device">
                            </Dropdown>
                        </div>
                        <span v-else>
                            Currently, Using MIDI devices in browser is only supported by Google
                            Chrome v43+, Opera v30+ and Microsoft Edge v79+. Please update to
                            one of those browsers if you want to use Web MIDI
                            functionalities.</span>
                    </div>
                    <!-- <modal name="settingsModal" :minWidth="700" :minHeight="600" :adaptive="true"> -->
                    <p class="settingsSubtitle">Agent Parameters</p>
                    <!-- <div class="md-layout md-gutter md-alignment-center"> -->
                        <!-- <div class="md-layout-item md-large-size-50 md-small-size-100">
                            <div class="md-layout md-gutter md-alignment-center"
                                style="display:flex;align-items:center;justify-content:center;"> -->
                                <!-- Sliders for agent Parameters -->
                                <div v-for="sliderItem in sliders" :key="'slider' + sliderItem.id"
                                    class="md-layout-item md-large-size-25 md-alignment-center"
                                    style="display:flex;align-items:center;
                                        justify-content:center;">
                                    <HorizontalSlider v-model="sliderItem.value"
                                                    :min="sliderItem.min" :max=sliderItem.max
                                        :label="sliderItem.label" />
                                </div>
                            <!-- </div>
                        </div> -->
                        <!-- <div class="md-layout-item md-large-size-50 md-small-size-100">
                            <div class="md-layout md-gutter md-alignment-center"> -->
                                <!-- Buttons for agent Parameters -->
                                <div v-for="buttonItem in buttons" :key="'button' + buttonItem.id">
                                    <!-- class="md-layout-item md-large-size-100"> -->
                                    <md-button
                                        @click="buttonAction(buttonItem.id)"
                                        style="width: 100%">
                                        <span class="forceTextColor">{{ buttonItem.label }}
                                        </span>
                                    </md-button>
                                </div>
                            <!-- </div>
                        </div>
                    </div> -->
                    <!-- <div class="md-layout md-gutter md-alignment-center">
                        <div class="md-layout-item md-large-size-100">
                            <div class="md-layout md-gutter md-alignment-center"> -->
                                <!-- Switches for agent Parameters -->
                                <div v-for="swi in switches" :key="'switch' + swi.id">
                                    <!-- class="md-layout-item md-large-size-25 md-medium-size-50"
                                    style="display:flex;align-items:center;
                                        justify-content:center;padding-top:17px"> -->
                                    <span style="padding:0; margin:0;">{{ swi.label }}</span>
                                    <div style="display:block; min-width:30px;">
                                        <toggle-button color="#74601c" v-model="swi.status"
                                            style="transform: scale(0.9);" />
                                    </div>
                                </div>
                            <!-- </div>
                        </div>
                    </div> -->
                    <!-- </modal> -->
                </div>
            </div>
        </modal>
    </div>
</template>

<script>
import HorizontalSlider from './HorizontalSlider.vue';
import BPMSlider from './BPMSlider.vue';
import Dropdown from 'vue-simple-search-dropdown';

export default {
    name: 'SettingsModal',
    components: {
        HorizontalSlider,
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
        };
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
        bpmValueChanged(bpm) {
            // Emit an event to notify the parent about the BPM change
            this.$emit('bpm-change', bpm);
        },
    },
};
</script>

<style scoped>
.forceTextColor {
    color: var(--text-color)!important;
}
.settingsTitle {
    font-size: 30px;
    padding-left: 5%;
    display: inline-block;
    font-weight: 800;
    color: var(--button-background-color);
    font-family: roboto;
}
.settingsHeader {
    z-index: 999;
    position: absolute;
    width: 100%;
    height: 80px;
    padding: 10px;
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
    padding-bottom: 10px;
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
    background-color: var(--grey-background-color);
    color: var(--text-color);
    height: 100%;
    padding: 80px 20px 20px 20px;
    font-size: 32px;
    font-family: roboto;
}

</style>


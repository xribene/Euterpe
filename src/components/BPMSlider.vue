<template>
    <div class="bpm-slider">
        <span class="label">{{ internalValue }}</span>
        <div class="range">
            <input class="horizontal slider" type="range"
                :min="min" :max="max" v-model="internalValue"
                @change="handleSliderChange($event.target.value)"
                @input="handleSliderDrag($event.target.value)"
            />
        </div>
    </div>
</template>

<script>
// Added last minute.
// TODO: Unify style with other sliders.

export default {
    name: 'BPMSlider',
    props: {
        value: {
            type: Number,
            required: true,
            default: 80,
        },
        min: {
            type: Number,
            default: 60,
        },
        max: {
            type: Number,
            default: 120,
        },
    },

    data() {
        return {
            internalValue: this.value,
        };
    },

    watch: {
        value(newVal) {
            this.internalValue = newVal;
        },
    },

    mounted() {
        this.handleSliderDrag(this.internalValue);
    },

    methods: {
        handleSliderChange(value) {
            // When the slider value changes, emit the 'input' event
            this.$emit('bpmChangeEvent', Number(value));
            this.handleSliderDrag(value);
        },

        handleSliderDrag(value) {
            // Update the background image for the slider
            const percent100 = (value - this.min) / (this.max - this.min) * 100;
            const bg = `linear-gradient(90deg,
                var(--bg-value-color) 0%,
                var(--bg-value-color) ${percent100}%,
                var(--bg-range-color) ${percent100}%,
                var(--bg-range-color) 100%)`;
            this.$el.querySelector('input').style.backgroundImage = bg;
        },
    },
};
</script>

<style scoped>
.bpm-slider {
    /* height: 0px;
    width: 300px; */
    width: 100%;
    display: flex;
    flex-direction: row;
    justify-content: left;
    align-items: left;
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

input {
    -webkit-appearance: none;
    appearance: none;
    outline: none;
    border-radius: 8px;
    background-color: transparent;

    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);

    background-image: linear-gradient(90deg,
            var(--bg-value-color) 0%,
            var(--bg-value-color) 30%,
            var(--bg-range-color) 30%,
            var(--bg-range-color) 100%);

    &::-webkit-slider-runnable-track {
        -webkit-appearance: none;
        appearance: none;
    }

    &::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 25px;
        height: 50px;
        background: transparent;
        border: none;
        cursor: pointer;
    }
}

.label {
    text-align: center;
    margin-top: 0px;
    margin-right: 14px;
}

.slider:hover {
    opacity: 1;
}
</style>


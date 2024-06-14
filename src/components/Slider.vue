<template>
    <div class="horizontal-slider">
      <div class="label">{{ label }}</div>
      <div class="slider-container">
        <input
          class="slider"
          type="range"
          :min="min"
          :max="max"
          :value="internalValue"
          @change="sendValue($event.target.value)"
          @input="updateValue($event.target.value)"
          orient="vertical"
        />
        <div class="value-indicator">{{ internalValue }}</div>
      </div>
    </div>
  </template>

<script>
export default {
  name: 'CustomSlider',
  props: {
    value: {
      type: Number,
      required: false,
    },
    min: {
      type: Number,
      default: 0,
    },
    max: {
      type: Number,
      default: 100,
    },
    label: {
      type: String,
      default: '',
    },
    orientation: {
      type: String,
      default: 'horizontal', // Added a prop for orientation, default is horizontal
    },
  },
    data() {
        return {
            internalValue: this.value,
        };
    },

  methods: {
    updateValue(value) {
        this.internalValue = value;
        console.log(value);
    },
    sendValue(value) {
        this.$emit('input', Number(value));
    }
  },
};
</script>

<style scoped>
.horizontal-slider {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 8px;
}

.slider-container {
    position: relative;
    display: flex;
    flex-direction: row;
    /* margin-right:1000px; */
    padding-right: 20px;
    /* text-align: center; */
}

.label {
    margin-bottom: 8px; /* Adjust the margin for better alignment */
    font-size: 20px;
    width: 150px;
}

.value-indicator {
    /* position: absolute; */
    top: 0;
    margin-left: 10px;
    /* left: 50%; */
    /* transform: translateX(-50%); */
    font-size: 12px;
    color: var(--grey-background-color);
    font-weight: 1000;
    background-color: var(--bg-value-color);
    border-radius: 8px;
    width: 30px;
    text-align: center;
}

.slider {
    writing-mode: bt-lr;
    /* -webkit-appearance: slider-horizontal; */
    /* width: 200px; */
    /* height: 40px; */
    /* padding-left: 20px; */
    /* margin: 0; */
    /* background: #d3d3d3; */
    outline: none;
    opacity: 0.9;
    -webkit-transition: .2s;
    transition: opacity .2s;
}

</style>

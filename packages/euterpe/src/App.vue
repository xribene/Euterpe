<template>
  <div id="app">
    <div ref="LoadingScreen" id="LoadingScreen">
      <div class="center">
        <p ref="agentStatus" class="loadingStatus">
          Loading Static Files, Please wait...
        </p>
        <div class="loader">
          <div class="loaderBar"></div>
        </div>
      </div>
    </div>
    <euterpe-view />
  </div>
</template>
<script>
import './css/app.css';
// loaded as its own chunk, behind the loading screen
const loadView = () => import('./views/Euterpe.vue');
export default {
    components: {EuterpeView: loadView},
    mounted() {
        loadView().then(() => this.$nextTick(() => {
            this.$refs.LoadingScreen.style.display = 'none';
        }));
    },
};
</script>

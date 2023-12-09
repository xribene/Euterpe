import Vue from 'vue';
import VueRouter from 'vue-router';

Vue.use(VueRouter);

const router = new VueRouter({
    mode: 'history',
    base: import.meta.env.BASE_URL,
    routes: [
        {
            path: '/',
            name: 'Home',
            component: () => import('../views/Home.vue'),
        },
        {
            path: '/bachduet',
            name: 'BachDuet',
            component: () => import('../views/BachDuet.vue'),
        },
        {
            path: '/pianogenie',
            name: 'PianoGenie',
            component: () => import('../views/PianoGenie.vue'),
        },
        {
            path: '/whistle2chords',
            name: 'WhistleToChords',
            component: () => import('../views/WhistleToChords.vue'),
        },
    ],
});

export default router;

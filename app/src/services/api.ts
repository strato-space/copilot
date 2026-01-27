import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api';
const voicebotBaseURL = import.meta.env.VITE_VOICEBOT_BASE_URL ?? 'https://voice.stratospace.fun';

export const apiClient = axios.create({
  baseURL,
  withCredentials: true,
});

export const voicebotClient = axios.create({
  baseURL: voicebotBaseURL,
  withCredentials: true,
});

import axios from 'axios';
import { create } from 'zustand'

import { useAuthUser } from "./AuthUser"

export const useRequest = create((set, get) => {
    const api_request = async (url, data, opt) => {
        if (opt?.silent != true) set({ loading: true })
        if (opt?.silent != true) set({ requestError: null })
        try {
            let response = { status: 0 }
            if (window.proxy_url) {
                response = await axios.post(window.proxy_url, data,
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "X-Proxy-Auth": window.proxy_auth,
                            "X-Proxy-Target-URL": `${window.backend_url}/${url}`,
                            "X-Authorization": useAuthUser.getState().auth_token
                        }
                    })
            } else {
                response = await axios.post(`${window.backend_url}/${url}`, data, { headers: { "X-Authorization": useAuthUser.getState().auth_token } })
            }
            if (response.status < 200 || response.status >= 300) {
                throw new Error('Failed to fetch! Try again.')
            }
            return response.data;
        } catch (error) {
            console.log(error)
            set({
                error: error.message,
                requestError: {
                    status: error?.response?.status || null,
                    statusText: error?.response?.statusText || null,
                    data: error?.response?.data || null
                }
            });
        } finally {
            if (opt?.silent != true) set({ loading: false })
        }
    }
    const sendFile = async (file, opt) => {
        const url = 'upload/file'
        const formData = new FormData();
        formData.append("file", file);
        if (opt?.silent != true) set({ loading: true })
        try {
            const response = await axios.post(`${window.backend_url}/${url}`, formData, {
                headers: {
                    "X-Authorization": useAuthUser.getState().auth_token,
                    'Content-Type': 'multipart/form-data'
                }
            })
            if (response.status < 200 || response.status >= 300) {
                throw new Error('Failed to send! Try again.')
            }
            return response.data;
        } catch (error) {
            console.log(error)
            set({ error: error.message });
        } finally {
            if (opt?.silent != true) set({ loading: false })
        }
    }
    const sendAudioFile = async (file, sessionId, opt) => {
        const url = 'voicebot/upload_audio'
        const formData = new FormData();
        formData.append("audio", file);
        formData.append("session_id", sessionId);
        if (opt?.silent != true) set({ loading: true })
        try {
            const response = await axios.post(`${window.backend_url}/${url}`, formData, {
                headers: {
                    "X-Authorization": useAuthUser.getState().auth_token
                },
                // Real upload progress (bytes) for large files.
                onUploadProgress: opt?.onUploadProgress
            })
            if (response.status < 200 || response.status >= 300) {
                throw new Error('Failed to send! Try again.')
            }
            return response.data;
        } catch (error) {
            console.log(error)
            set({ error: error.message });
            throw error;
        } finally {
            if (opt?.silent != true) set({ loading: false })
        }
    }
    return ({
        loading: false,
        setLoading: (isLoading) => set(state => ({ loading: isLoading })),
        requestError: null,
        error: '',
        api_request,
        sendFile,
        sendAudioFile,
        getAuthToken: () => useAuthUser.getState().auth_token
    })
})

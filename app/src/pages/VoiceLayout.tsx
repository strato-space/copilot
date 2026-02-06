import { Outlet } from 'react-router-dom';
// import WebrtcFabLoader from '../components/voice/WebrtcFabLoader';

export default function VoiceLayout() {
    return (
        <>
            <Outlet />
            {/* <WebrtcFabLoader /> */}
        </>
    );
}

declare global {
    interface TelegramWebApp {
        initData: string;
        viewportHeight: number;
        viewportWidth: number;
        isWeb?: boolean;
        expand: () => void;
        MainButton: {
            hide: () => void;
        };
        enableClosingConfirmation: () => void;
        disableVerticalSwipes?: () => void;
    }

    interface Window {
        backend_url: string;
        proxy_url?: string;
        proxy_auth?: string;
        Telegram?: {
            WebApp: TelegramWebApp;
        };
    }
}

export { };

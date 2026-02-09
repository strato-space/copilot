import { create } from 'zustand';

interface TelegramState {
    telegram: TelegramWebApp;
    initData: string;
}

const getTelegramWebApp = (): TelegramWebApp => {
    if (window.Telegram?.WebApp && window.Telegram.WebApp.initData !== '') {
        return window.Telegram.WebApp;
    }

    return {
        initData: '',
        viewportHeight: 896,
        viewportWidth: 414,
        isWeb: true,
        expand: () => { },
        MainButton: {
            hide: () => { },
        },
        enableClosingConfirmation: () => { },
        disableVerticalSwipes: () => { },
    };
};

export const useTelegram = create<TelegramState>(() => {
    const tg = getTelegramWebApp();

    if (!tg.isWeb) {
        tg.expand();
        tg.MainButton.hide();
        tg.enableClosingConfirmation();
        tg.disableVerticalSwipes?.();
    }

    return {
        telegram: tg,
        initData: tg.initData,
    };
});

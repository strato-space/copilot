import { create } from 'zustand';

const useAgentResults = create((set, get) => ({
    // Состояние
    currentResult: null,

    // Действия
    setResult: (result) => {
        console.log('Setting agent result:', result);
        set({ currentResult: result });
    },

    clearResult: () => {
        console.log('Clearing agent result');
        set({ currentResult: null });
    },

    // Геттеры
    hasResult: () => {
        const { currentResult } = get();
        return currentResult !== null && currentResult?.data?.executionResult?.final_output;
    }
}));

export default useAgentResults;
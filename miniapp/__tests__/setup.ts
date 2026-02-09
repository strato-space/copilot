import '@testing-library/jest-dom';

Object.defineProperty(window, 'backend_url', {
    value: 'http://localhost:8084',
    writable: true,
});

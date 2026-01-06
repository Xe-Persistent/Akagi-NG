import type { ToastOptions, UpdateOptions } from 'react-toastify';
import { toast } from 'react-toastify';

const defaultOptions: ToastOptions = {
  position: 'top-right',
  autoClose: 5000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
};

export const notify = {
  success: (message: string, options?: ToastOptions) => {
    toast.success(message, { ...defaultOptions, ...options });
  },
  error: (message: string, options?: ToastOptions) => {
    toast.error(message, { ...defaultOptions, ...options });
  },
  info: (message: string, options?: ToastOptions) => {
    toast.info(message, { ...defaultOptions, ...options });
  },
  warn: (message: string, options?: ToastOptions) => {
    toast.warn(message, { ...defaultOptions, ...options });
  },
  loading: (message: string, options?: ToastOptions) => {
    return toast.loading(message, { ...defaultOptions, ...options });
  },
  update: (id: string | number, options: UpdateOptions) => {
    toast.update(id, { ...defaultOptions, ...options });
  },
  dismiss: (id?: string | number) => {
    toast.dismiss(id);
  },
};

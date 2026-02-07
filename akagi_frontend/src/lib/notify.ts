import type { Id, ToastOptions, UpdateOptions } from 'react-toastify';
import { toast } from 'react-toastify';

import { TOAST_DURATION_DEFAULT } from '@/config/constants';

const defaultOptions: ToastOptions = {
  position: 'top-right',
  autoClose: TOAST_DURATION_DEFAULT,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
};

export const notify = {
  success: (message: string, options?: ToastOptions): Id => {
    return toast.success(message, { ...defaultOptions, ...options });
  },
  error: (message: string, options?: ToastOptions): Id => {
    return toast.error(message, { ...defaultOptions, ...options });
  },
  info: (message: string, options?: ToastOptions): Id => {
    return toast.info(message, { ...defaultOptions, ...options });
  },
  warn: (message: string, options?: ToastOptions): Id => {
    return toast.warn(message, { ...defaultOptions, ...options });
  },
  loading: (message: string, options?: ToastOptions): Id => {
    return toast.loading(message, { ...defaultOptions, ...options });
  },
  update: (id: string | number, options: UpdateOptions): void => {
    toast.update(id, { ...defaultOptions, ...options });
  },
  dismiss: (id?: string | number): void => {
    toast.dismiss(id);
  },
};

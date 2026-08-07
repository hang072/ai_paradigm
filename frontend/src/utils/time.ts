import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function fromNow(t: string): string {
  return dayjs(t).fromNow();
}

export function ymdhms(t: string): string {
  return dayjs(t).format('YYYY-MM-DD HH:mm');
}

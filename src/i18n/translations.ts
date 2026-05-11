export type Locale = 'en' | 'vi';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'vi'];

export const localeLabels: Record<Locale, string> = {
  en: 'English',
  vi: 'Tiếng Việt',
};

export const translations: Record<Locale, Record<string, string>> = {
  en: {
    'login.kicker': 'Private Cockpit Access',
    'login.title': 'Sign in to your agent control surface',
    'login.description': 'Nerve is the high visibility workspace for OpenClaw agents. Authenticate once, then manage chats, tasks, files, memory, and telemetry from one place.',
    'login.heading': 'Unlock Nerve',
    'login.body': 'Enter the password configured for this deployment. Your gateway token also works if password auth is using the fallback path.',
    'login.passwordLabel': 'Password',
    'login.passwordPlaceholder': 'Enter password',
    'login.submit': 'Enter Nerve',
    'login.submitting': 'Signing In…',
    'login.languageLabel': 'Language',
    'login.languageHelp': 'Choose the interface language before signing in.',
    'login.needHelp': 'Need to recover access? Check the gateway configuration or deployment notes where the token was originally set.',
    'login.sessions': 'Live agent context',
    'login.workspace': 'Files, memory, and skills',
    'login.telemetry': 'Costs, events, and uptime',
    'login.featureSessions': 'Sessions',
    'login.featureWorkspace': 'Workspace',
    'login.featureTelemetry': 'Telemetry',
    'login.authenticationRequired': 'Authentication Required',

    'settings.appearance': 'Appearance',
    'settings.language': 'Language',
    'settings.languageHelp': 'Select the UI language for this browser.',
  },
  vi: {
    'login.kicker': 'Truy cập khoang điều khiển riêng',
    'login.title': 'Đăng nhập vào bảng điều khiển agent',
    'login.description': 'Nerve là không gian làm việc hiển thị cho các agent OpenClaw. Xác thực một lần, sau đó quản lý chat, nhiệm vụ, tệp, bộ nhớ và báo cáo từ một nơi.',
    'login.heading': 'Mở khóa Nerve',
    'login.body': 'Nhập mật khẩu đã cấu hình cho triển khai này. Token gateway cũng hoạt động nếu xác thực mật khẩu sử dụng fallback.',
    'login.passwordLabel': 'Mật khẩu',
    'login.passwordPlaceholder': 'Nhập mật khẩu',
    'login.submit': 'Vào Nerve',
    'login.submitting': 'Đang đăng nhập…',
    'login.languageLabel': 'Ngôn ngữ',
    'login.languageHelp': 'Chọn ngôn ngữ giao diện trước khi đăng nhập.',
    'login.needHelp': 'Cần khôi phục quyền truy cập? Kiểm tra cấu hình gateway hoặc ghi chú triển khai nơi token đã được thiết lập.',
    'login.sessions': 'Ngữ cảnh agent trực tiếp',
    'login.workspace': 'Tệp, bộ nhớ và kỹ năng',
    'login.telemetry': 'Chi phí, sự kiện và thời gian hoạt động',
    'login.featureSessions': 'Phiên',
    'login.featureWorkspace': 'Không gian làm việc',
    'login.featureTelemetry': 'Giám sát',
    'login.authenticationRequired': 'Yêu cầu xác thực',

    'settings.appearance': 'Giao diện',
    'settings.language': 'Ngôn ngữ',
    'settings.languageHelp': 'Chọn ngôn ngữ giao diện cho trình duyệt này.',
  },
};

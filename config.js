// アプリの設定。
// endpoint：β版の提案・意見・結果を受け取る場所のURL。空のあいだは自動では届かず、
//           利用者が「共有」または「コピー」して運営に送る形になる。
//           受け取り口を用意したら、そのURLをここに入れるだけで自動送信に切りかわる。
//           （送る形式：POST、本文は JSON 文字列 { kind, text, version, at }）
const CONFIG = {
  version: 'β 0.6',
  endpoint: 'https://script.google.com/macros/s/AKfycbxb9_KqaBwCPIoWAR-EGh69PTjVUzLlZjb9kVrLqlymMat0vILf9ucvlQ4vgQhf8n1B3g/exec',
};

// 「新しくなったところ」に出す内容（新しい順）
const CHANGES = [
  ['β 0.6', 'ダイエット法を自分で追加・提案できるように。意見や結果を運営に送れるように。記録の引っこしを追加。'],
  ['β 0.5', '3日後は別の方法へ。ためした方法は1ヶ月後にまた選べる。ひとことメモを追加。'],
  ['β 0.4', '「今日はできなかった」も記録できるように。途中での切りかえを廃止。'],
  ['β 0.3', '相性レポートを追加。スマホのホーム画面に置けるように。'],
];

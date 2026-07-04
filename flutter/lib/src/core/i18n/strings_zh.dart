/// Chinese (Simplified) strings for the iApp eKYC SDK (formal register).
const Map<String, String> ekycStringsZh = {
  // Document capture
  'searching_card': '请您将证件对准取景框',
  'hold_still': '请您保持稳定…',
  'too_blurry': '图像过于模糊，请您保持相机稳定',
  'move_closer': '请您靠近证件一些',
  'align_card': '请您将证件与取景框对齐',
  'capturing': '正在拍摄…',
  'uploading': '正在上传…',
  'done': '完成',
  'manual_capture': '手动拍摄',

  // Common actions
  'cancel': '取消',
  'retry': '重试',
  'close': '关闭',
  'try_again': '再试一次',

  // Camera
  'camera_permission_denied': '需要相机权限，请您允许访问相机。',
  'camera_error': '无法启动相机',

  // Face positioning
  'position_face': '请您将面部置于椭圆框内',
  'hold_face': '请您保持不动，将面部置于椭圆框内',
  'move_face_closer': '请您靠近相机一些',
  'center_face': '请您将面部置于椭圆框中央',
  'look_straight': '请您直视相机',
  'multiple_faces': '画面中请您只保留一张面部',
  'face_lost': '未检测到面部，请您回到椭圆框内',

  // Active liveness challenges
  'blink_now': '请您眨眼',
  'turn_left': '请您向左转头',
  'turn_right': '请您向右转头',
  'smile_now': '请您微笑',
  'recenter_face': '请您再次直视相机',
  'challenge_passed': '很好',
  'liveness_success': '活体检测通过',
  'liveness_failed': '活体检测未通过',
  'liveness_timeout': '已超时，请您重新尝试',
  'too_many_restarts': '尝试次数过多，请您重新开始',

  // Progress
  'processing': '正在处理…',
  'finalizing': '正在核验…',
  'verifying': '正在核验…',

  // Errors
  'error_generic': '发生错误，请您重试。',
  'error_bad_request': '请求无效，请您重试。',
  'error_invalid_key': 'API 密钥无效，请您核对您的凭证。',
  'error_no_credit': '余额不足，请您前往 iapp.co.th/control/credits 充值。',
  'error_file_too_large': '图片过大（上限 10 MB）。',
  'error_rate_limited': '请求过于频繁，请您稍后重试。',
  'error_server': '服务器错误，请您稍后重试。',
  'error_network': '网络错误，请您检查网络连接。',
  'error_timeout': '请求超时，请您重试。',
};

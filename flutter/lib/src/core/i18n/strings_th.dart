/// Thai strings for the iApp eKYC SDK (polite formal register).
const Map<String, String> ekycStringsTh = {
  // Document capture
  'searching_card': 'กรุณาวางเอกสารให้อยู่ในกรอบ',
  'hold_still': 'กรุณาถือกล้องนิ่ง ๆ สักครู่',
  'too_blurry': 'ภาพเบลอเกินไป กรุณาถือกล้องให้นิ่ง',
  'move_closer': 'กรุณาขยับกล้องเข้าใกล้เอกสารมากขึ้น',
  'align_card': 'กรุณาจัดเอกสารให้ตรงกับกรอบ',
  'capturing': 'กำลังถ่ายภาพ…',
  'uploading': 'กำลังอัปโหลด…',
  'done': 'เสร็จสิ้น',
  'manual_capture': 'ถ่ายภาพด้วยตนเอง',

  // Common actions
  'cancel': 'ยกเลิก',
  'retry': 'ลองใหม่',
  'close': 'ปิด',
  'try_again': 'ลองอีกครั้ง',

  // Camera
  'camera_permission_denied':
      'จำเป็นต้องใช้สิทธิ์กล้อง กรุณาอนุญาตการเข้าถึงกล้อง',
  'camera_error': 'ไม่สามารถเปิดกล้องได้',

  // Face positioning
  'position_face': 'กรุณาให้ใบหน้าอยู่ภายในกรอบวงรี',
  'hold_face': 'กรุณาอยู่นิ่ง ๆ และให้ใบหน้าอยู่ในกรอบวงรี',
  'move_face_closer': 'กรุณาขยับใบหน้าเข้าใกล้กล้องมากขึ้น',
  'center_face': 'กรุณาให้ใบหน้าอยู่กึ่งกลางกรอบวงรี',
  'look_straight': 'กรุณามองตรงมาที่กล้อง',
  'multiple_faces': 'กรุณาให้มีใบหน้าเพียงหนึ่งเดียวในภาพ',
  'face_lost': 'ไม่พบใบหน้า กรุณากลับมาอยู่ในกรอบวงรี',

  // Active liveness challenges
  'blink_now': 'กรุณากะพริบตา',
  'turn_left': 'กรุณาหันหน้าไปทางซ้าย',
  'turn_right': 'กรุณาหันหน้าไปทางขวา',
  'smile_now': 'กรุณายิ้ม',
  'recenter_face': 'กรุณามองตรงมาที่กล้องอีกครั้ง',
  'challenge_passed': 'เรียบร้อย',
  'liveness_success': 'การตรวจสอบใบหน้าผ่านเรียบร้อย',
  'liveness_failed': 'การตรวจสอบใบหน้าไม่ผ่าน',
  'liveness_timeout': 'หมดเวลา กรุณาลองใหม่อีกครั้ง',
  'too_many_restarts': 'ลองหลายครั้งเกินไป กรุณาเริ่มใหม่อีกครั้ง',

  // Progress
  'processing': 'กำลังประมวลผล…',
  'finalizing': 'กำลังตรวจสอบ…',
  'verifying': 'กำลังตรวจสอบ…',

  // Errors
  'error_generic': 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
  'error_bad_request': 'คำขอไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
  'error_invalid_key': 'คีย์ API ไม่ถูกต้อง กรุณาตรวจสอบข้อมูลรับรองของท่าน',
  'error_no_credit':
      'เครดิตไม่เพียงพอ กรุณาเติมเครดิตที่ iapp.co.th/control/credits',
  'error_file_too_large': 'ไฟล์ภาพมีขนาดใหญ่เกินไป (สูงสุด 10 MB)',
  'error_rate_limited': 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่',
  'error_server': 'เซิร์ฟเวอร์ขัดข้อง กรุณาลองใหม่ภายหลัง',
  'error_network': 'เครือข่ายขัดข้อง กรุณาตรวจสอบการเชื่อมต่อ',
  'error_timeout': 'คำขอหมดเวลา กรุณาลองใหม่อีกครั้ง',
};

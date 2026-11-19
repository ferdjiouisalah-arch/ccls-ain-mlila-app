import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '5mb' }));

const dbPath = path.resolve(process.cwd(), 'database.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    field1 TEXT NOT NULL,
    field2 TEXT NOT NULL,
    ext_type TEXT NOT NULL DEFAULT '',
    ext_kg TEXT NOT NULL DEFAULT '',
    facility TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'عادي',
    responsible TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    manual_status TEXT NOT NULL DEFAULT 'auto',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS directive_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_code TEXT NOT NULL,
    section_title TEXT NOT NULL,
    item_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    target_category TEXT NOT NULL,
    facility TEXT NOT NULL DEFAULT 'مركب عين مليلة',
    status TEXT NOT NULL DEFAULT 'قيد التنفيذ',
    responsible TEXT NOT NULL DEFAULT 'لطفي محمد بلغربي',
    last_checked TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER,
    action TEXT NOT NULL,
    record_type TEXT NOT NULL,
    facility TEXT NOT NULL,
    summary TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'مسؤول الأمن والوقاية (HSE)',
    facility TEXT NOT NULL DEFAULT 'مركب عين مليلة',
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS facilities_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    search_query TEXT NOT NULL,
    lat REAL,
    lng REAL,
    address TEXT NOT NULL DEFAULT '',
    geocoded_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS fire_motors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    motor_code TEXT NOT NULL,
    motor_name TEXT NOT NULL,
    facility TEXT NOT NULL,
    power_kw REAL NOT NULL DEFAULT 0,
    pressure_bar REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'تعمل',
    last_test_date TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT 'لطفي محمد بلغربي',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS water_tanks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_code TEXT NOT NULL,
    tank_name TEXT NOT NULL,
    facility TEXT NOT NULL,
    capacity_m3 REAL NOT NULL DEFAULT 100,
    current_m3 REAL NOT NULL DEFAULT 0,
    min_safe_m3 REAL NOT NULL DEFAULT 30,
    last_inspection TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT 'لطفي محمد بلغربي',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS security_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    supervisor_name TEXT NOT NULL DEFAULT 'لطفي محمد بلغربي',
    supervisor_phone TEXT NOT NULL DEFAULT '',
    sms_alert_enabled INTEGER NOT NULL DEFAULT 1,
    sms_webhook_url TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS intruder_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempted_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    target_supervisor TEXT NOT NULL DEFAULT 'لطفي محمد بلغربي',
    target_phone TEXT NOT NULL DEFAULT '',
    sms_status TEXT NOT NULL DEFAULT '',
    sms_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS storage_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_label TEXT NOT NULL,
    category TEXT NOT NULL,
    device_type TEXT NOT NULL,
    record_count INTEGER NOT NULL DEFAULT 0,
    motor_count INTEGER NOT NULL DEFAULT 0,
    tank_count INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'لطفي محمد بلغربي',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_alarms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    facility TEXT NOT NULL DEFAULT 'مركب عين مليلة',
    due_datetime TEXT NOT NULL,
    repeat_cycle TEXT NOT NULL DEFAULT 'يومي',
    sound_enabled INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT 'لطفي محمد بلغربي',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function ensureRecordsColumns(): void {
  const cols = db.prepare('PRAGMA table_info(records)').all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('ext_type')) {
    db.exec(`ALTER TABLE records ADD COLUMN ext_type TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('ext_kg')) {
    db.exec(`ALTER TABLE records ADD COLUMN ext_kg TEXT NOT NULL DEFAULT ''`);
  }
  // Backfill existing extinguisher rows if ext_type is empty
  db.prepare(`UPDATE records SET ext_type = 'بودرة جافة ABC', ext_kg = '9' WHERE type = 'extinguishers' AND ext_type = '' AND field1 LIKE '%9%'`).run();
  db.prepare(`UPDATE records SET ext_type = 'ثاني أكسيد الكربون CO2', ext_kg = '6' WHERE type = 'extinguishers' AND ext_type = '' AND field1 LIKE '%CO2%'`).run();
  db.prepare(`UPDATE records SET ext_type = 'بودرة جافة ABC', ext_kg = '50' WHERE type = 'extinguishers' AND ext_type = '' AND field1 LIKE '%50%'`).run();
}

function ensureDirectiveColumns(): void {
  const cols = db.prepare('PRAGMA table_info(directive_items)').all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('periodicity')) {
    db.exec(`ALTER TABLE directive_items ADD COLUMN periodicity TEXT NOT NULL DEFAULT 'شهري'`);
  }
  if (!colNames.has('next_due_date')) {
    db.exec(`ALTER TABLE directive_items ADD COLUMN next_due_date TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('alarm_enabled')) {
    db.exec(`ALTER TABLE directive_items ADD COLUMN alarm_enabled INTEGER NOT NULL DEFAULT 1`);
  }
  if (!colNames.has('is_custom')) {
    db.exec(`ALTER TABLE directive_items ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0`);
  }
}

ensureRecordsColumns();
ensureDirectiveColumns();

function formatOffsetDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function seedInitialData(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM records').get() as { total: number };
  if (countRow.total > 0) {
    return;
  }

  const initialRecords = [
    {
      type: 'hse',
      field1: 'مراقبة تركيز غبار الحبوب والتهوية',
      field2: 'فحص نظام الشفط المركزي وفلاتر الهواء في برج الصوامع',
      facility: 'مركب عين مليلة',
      start_date: formatOffsetDate(-90),
      end_date: formatOffsetDate(180),
      priority: 'مهم',
      responsible: 'كريم بن يحيى',
      notes: 'النتائج مطابقة لمعايير الديوان الجزائري المهني للحبوب',
      manual_status: 'auto',
    },
    {
      type: 'hse',
      field1: 'تأمين فضاءات العمل والسلالم العلوية',
      field2: 'التحقق من حواجز الحماية ومعدات العمل على الارتفاعات',
      facility: 'مركب طاقزة',
      start_date: formatOffsetDate(-165),
      end_date: formatOffsetDate(14),
      priority: 'عاجل',
      responsible: 'سمير لعريبي',
      notes: 'مراجعة دورية نصف سنوية مطلوبة قبل نهاية الشهر',
      manual_status: 'auto',
    },
    {
      type: 'hse',
      field1: 'فحص خزانات التبخير وحماية المخزون',
      field2: 'معايرة أجهزة كشف غاز الفوسفين وتوفير أقنعة التنفس',
      facility: 'وحدة سيڨوس',
      start_date: formatOffsetDate(-120),
      end_date: formatOffsetDate(95),
      priority: 'مهم',
      responsible: 'نور الدين بوزيد',
      notes: 'تجهيزات الوقاية متوفرة ومختومة',
      manual_status: 'auto',
    },
    {
      type: 'hse',
      field1: 'تحديث مخطط الإخلاء والتدخل السريع',
      field2: 'مناورة تدريبية لفرق التدخل الأولي وتأمين مخارج الطوارئ',
      facility: 'محطة بذور أولاد حملة',
      start_date: formatOffsetDate(-380),
      end_date: formatOffsetDate(-12),
      priority: 'عاجل',
      responsible: 'طارق قاسمي',
      notes: 'تأخر في جدول المناورة بسبب أشغال التهيئة الخارجية',
      manual_status: 'auto',
    },
    {
      type: 'maintenance',
      field1: 'المصعد الدلوي الرئيسي E-01',
      field2: 'تشديد السير الناقل وفحص المحرك الكهربائي 45 كيلوواط',
      facility: 'مركب عين مليلة',
      start_date: formatOffsetDate(-45),
      end_date: formatOffsetDate(135),
      priority: 'مهم',
      responsible: 'عبد الحق منصوري',
      notes: 'تم تشحيم جميع المحامل وتغيير حساس السرعة',
      manual_status: 'auto',
    },
    {
      type: 'maintenance',
      field1: 'الميزان الجسري الإلكتروني 60 طن',
      field2: 'معايرة خلايا الوزن والتحقق من اللوحة الرقمية',
      facility: 'وحدة عين فكرون',
      start_date: formatOffsetDate(-345),
      end_date: formatOffsetDate(19),
      priority: 'مهم',
      responsible: 'فريد بوخالفة',
      notes: 'في انتظار زيارة هيئة المعايرة القانونية',
      manual_status: 'auto',
    },
    {
      type: 'maintenance',
      field1: 'الناقل السلسلي الأفقي C-04',
      field2: 'استبدال الحلقات المتآكلة ومحاذاة التروس',
      facility: 'مركب طاقزة',
      start_date: formatOffsetDate(-10),
      end_date: formatOffsetDate(60),
      priority: 'عادي',
      responsible: 'رشيد جباري',
      notes: 'جاري استكمال الضبط النهائي تحت الحمل',
      manual_status: 'قيد التدخل',
    },
    {
      type: 'maintenance',
      field1: 'منظومة التنظيف الأولي للقمح',
      field2: 'تبديل الغرابيل الاهتزازية وتنظيف مجاري السحب',
      facility: 'وحدة عين كرشة',
      start_date: formatOffsetDate(-195),
      end_date: formatOffsetDate(-8),
      priority: 'عاجل',
      responsible: 'عادل زروقي',
      notes: 'يتطلب توقيف الخط لساعتين لإجراء الصيانة',
      manual_status: 'auto',
    },
    {
      type: 'extinguishers',
      field1: 'EXT-ML-014',
      field2: 'الطابق الأرضي - مدخل غرفة التحكم الكهربائية',
      ext_type: 'بودرة جافة ABC',
      ext_kg: '9',
      facility: 'مركب عين مليلة',
      start_date: formatOffsetDate(-180),
      end_date: formatOffsetDate(185),
      priority: 'عادي',
      responsible: 'كريم بن يحيى',
      notes: 'الضغط في المجال الأخضر والختم سليم',
      manual_status: 'auto',
    },
    {
      type: 'extinguishers',
      field1: 'EXT-TG-007',
      field2: 'خزانة القواطع الكهربائية الرئيسية',
      ext_type: 'ثاني أكسيد الكربون CO2',
      ext_kg: '6',
      facility: 'مركب طاقزة',
      start_date: formatOffsetDate(-340),
      end_date: formatOffsetDate(22),
      priority: 'مهم',
      responsible: 'سمير لعريبي',
      notes: 'تحتاج إعادة وزن وتجديد شهادة الضغط',
      manual_status: 'auto',
    },
    {
      type: 'extinguishers',
      field1: 'EXT-SN-003',
      field2: 'ساحة التفريغ الشمالية وميزان الشاحنات (على عجلات)',
      ext_type: 'بودرة جافة ABC',
      ext_kg: '50',
      facility: 'وحدة سوق نعمان',
      start_date: formatOffsetDate(-200),
      end_date: formatOffsetDate(165),
      priority: 'عادي',
      responsible: 'يوسف حماني',
      notes: 'مغطاة بغلاف واقٍ من أشعة الشمس',
      manual_status: 'auto',
    },
    {
      type: 'extinguishers',
      field1: 'EXT-BC-011',
      field2: 'المخزن الفرعي للبقول الجافة - البوابة B',
      ext_type: 'بودرة جافة ABC',
      ext_kg: '9',
      facility: 'المركز الجواري بئر الشهداء',
      start_date: formatOffsetDate(-380),
      end_date: formatOffsetDate(-15),
      priority: 'عاجل',
      responsible: 'جمال عيساوي',
      notes: 'منتهية الصلاحية ويجب إرسالها لإعادة الشحن فوراً',
      manual_status: 'auto',
    },
    {
      type: 'smoke',
      field1: 'SMK-ML-Z1-04 · كاشف ضوئي',
      field2: 'الرواق العلوي فوق الخلايا 1 إلى 6 (يعمل بانتظام)',
      facility: 'مركب عين مليلة',
      start_date: formatOffsetDate(-60),
      end_date: formatOffsetDate(120),
      priority: 'عادي',
      responsible: 'كريم بن يحيى',
      notes: 'تم تنظيف الغرفة البصرية بالهواء المضغوط',
      manual_status: 'auto',
    },
    {
      type: 'smoke',
      field1: 'SMK-BS-Z2-02 · كاشف حراري',
      field2: 'إنذار كاذب متكرر بسبب تراكم الغبار حول الحساس',
      facility: 'وحدة بئر الشهداء',
      start_date: formatOffsetDate(-15),
      end_date: formatOffsetDate(10),
      priority: 'عاجل',
      responsible: 'فؤاد مرابط',
      notes: 'تم عزل المنطقة مؤقتاً في انتظار استبدال الرأس الحساس',
      manual_status: 'معطل',
    },
    {
      type: 'smoke',
      field1: 'SMK-BG-Z1-01 · لوحة إنذار رئيسية',
      field2: 'بطاريات الاحتياط الخاصة باللوحة تحتاج فحص الجهد',
      facility: 'المركز الجواري بوغرارة السعودي',
      start_date: formatOffsetDate(-350),
      end_date: formatOffsetDate(15),
      priority: 'مهم',
      responsible: 'حسين بوعزيز',
      notes: 'استجابة صفارات الإنذار طبيعية',
      manual_status: 'auto',
    },
    {
      type: 'smoke',
      field1: 'SMK-HT-Z1-03 · كاشف دخان ليزري',
      field2: 'مستودع الأكياس المعبأة - الجهة الشرقية',
      facility: 'المركز الجواري هنشير تومغني',
      start_date: formatOffsetDate(-40),
      end_date: formatOffsetDate(140),
      priority: 'عادي',
      responsible: 'نبيل شايب',
      notes: 'يعمل بكفاءة ولا توجد أعطال',
      manual_status: 'auto',
    },
  ];

  const insertRecord = db.prepare(`
    INSERT INTO records (type, field1, field2, ext_type, ext_kg, facility, start_date, end_date, priority, responsible, notes, manual_status)
    VALUES (@type, @field1, @field2, @ext_type, @ext_kg, @facility, @start_date, @end_date, @priority, @responsible, @notes, @manual_status)
  `);

  const insertLog = db.prepare(`
    INSERT INTO activity_logs (record_id, action, record_type, facility, summary, actor)
    VALUES (?, 'إضافة', ?, ?, ?, 'النظام التأسيسي')
  `);

  const transaction = db.transaction(() => {
    for (const rec of initialRecords) {
      const payload = { ext_type: '', ext_kg: '', ...rec };
      const info = insertRecord.run(payload);
      insertLog.run(info.lastInsertRowid, rec.type, rec.facility, rec.field1);
    }
  });

  transaction();
}

function seedDirectiveChecklist(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM directive_items').get() as { total: number };
  if (countRow.total > 0) {
    return;
  }

  const today = formatOffsetDate(0);
  const points: Array<{
    section_code: string;
    section_title: string;
    item_number: number;
    title: string;
    description: string;
    target_category: string;
    status: string;
  }> = [
    // Section I: HSE (11 points)
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 1,
      title: 'التنظيف المنتظم والصارم لكافة المنشآت',
      description: 'تنظيف خلايا التخزين وأبراج العمل والأروقة ومراكز الاستقبال والشحن ومنع تراكم الغبار القابل للاشتعال باستخدام المكانس الصناعية المقتناة ضمن المشروع.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 2,
      title: 'الفحص اليومي لأنظمة إزالة الغبار (Dépoussiérage)',
      description: 'التحقق يومياً من حسن سير أنظمة شفط الغبار خاصة الفلاتر والمراوح وأجهزة المراقبة المرتبطة بها لضمان فعاليتها.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 3,
      title: 'التوعية والتكوين الدوري لعمال استغلال الصوامع',
      description: 'تحسيس وتكوين العمال بانتظام حول مخاطر المناولة وتخزين الحبوب لا سيما مخاطر الحريق وانفجار الغبار وحوادث العمل.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 4,
      title: 'المراقبة الدورية لوسائل مكافحة الحرائق',
      description: 'فحص مطفآت الحريق وتجهيزات الكشف وأجهزة الإنذار بصفة دورية بالتنسيق مع مصالح الحماية المدنية.',
      target_category: 'extinguishers',
      status: 'قيد التنفيذ',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 5,
      title: 'توفير ألبسة العمل ومعدات الوقاية الفردية (EPI)',
      description: 'تزويد جميع العمال المتدخلين بأقنعة الحماية التنفسية، واقيات السمع، أحذية السلامة، الخوذ، والنظارات الواقية الملائمة للمخاطر.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 6,
      title: 'الفحص اليومي للمولد الكهربائي الاحتياطي',
      description: 'التأكد يومياً من حسن اشتغال المولد الكهربائي الاحتياطي (Groupe électrogène de secours) وجاهزيته عند انقطاع التيار.',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 7,
      title: 'تثبيت لوحات الإشارة والتحذير في أماكن ظاهرة',
      description: 'لوحات منع التدخين، منع دخول غير المرخصين، إلزامية ارتداء معدات الوقاية الفردية، وتعليمات التصرف في حالات الطوارئ.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 8,
      title: 'تنظيف محيط المنشآت وإخلاء النفايات والبقايا',
      description: 'التنظيف المنتظم لمحيط الصوامع والإزالة المنهجية للبقايا والنفايات لتفادي تكاثر الآفات أو التلوث أو اندلاع الحرائق.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 9,
      title: 'الفحص الدوري لنظام كشف الدخان والإنذار',
      description: 'فحص كواشف الدخان وأجهزة الإنذار بالحريق وكافة تجهيزات السلامة قبل أي تشغيل للمنشآت.',
      target_category: 'smoke',
      status: 'قيد التنفيذ',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 10,
      title: 'الجاهزية الدائمة لمخارج النجدة ومسالك الإخلاء',
      description: 'إبقاء مخارج الطوارئ وممرات الإخلاء ومنافذ سيارات الإسعاف والحماية المدنية مفتوحة وخالية من أي عوائق.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'I',
      section_title: 'I. النظافة والأمن والبيئة (HSE)',
      item_number: 11,
      title: 'منع الأشغال باللهب المكشوف واللحام دون ترخيص',
      description: 'المنع الصارم لأي تدخل باللهب المكشوف أو اللحام أو القص أو أي عمل مولد للشرر دون ترخيص مسبق وتقييم مخاطر.',
      target_category: 'hse',
      status: 'مطابق',
    },

    // Section II: Organisation et gestion des services de maintenance (9 points)
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 1,
      title: 'إعداد برنامج صيانة وقائية شامل للصوامع',
      description: 'تغطية التجهيزات الميكانيكية، الكهربائية، الكهروميكانيكية والمنشآت الملحقة وعرضه على مصادقة المديرية التقنية للديوان (DTEI).',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 2,
      title: 'المتابعة الصارمة ومسك البطاقات وسجلات التدخل',
      description: 'إعداد وتحيين البطاقات التقنية وسجلات التدخل وتاريخ الصيانة وفق التنظيم المعمول به وتعليمات المصنّعين.',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 3,
      title: 'تنظيم الموارد البشرية للاستغلال والصيانة',
      description: 'تحديد المهام والمسؤوليات وصلاحيات كل متدخل في الاستغلال والصيانة بشكل واضح ودقيق.',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 4,
      title: 'تعزيز وتيرة التنظيف والتوقفات التقنية المبرمجة',
      description: 'برمجة توقفات تقنية دورية بالتنسيق مع DTEI لإجراء الفحوصات والتدخلات التقنية في ظروف آمنة.',
      target_category: 'maintenance',
      status: 'قيد التنفيذ',
    },
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 5,
      title: 'التفتيش الدوري لتجهيزات المناولة والنقل',
      description: 'فحص المصاعد الدلوية (Élévateurs à godets)، النواقل السلسلية، اللوالب الناقلة، وتجهيزات التنظيف ومراقبة التآكل والحماية.',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 6,
      title: 'فحص التجهيزات الكهربائية وPLC وقاعة MCC والتأريض',
      description: 'مراقبة خزائن التحكم والكوابل وأجهزة التأريض (Mise à la terre) والتحقق من مطابقتها لمعايير مخاطر الغبار القابل للاشتعال.',
      target_category: 'maintenance',
      status: 'قيد التنفيذ',
    },
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 7,
      title: 'توفير قطع الغيار الأساسية وتعبئة الفرق التقنية',
      description: 'ضمان المخزون الأدنى من قطع الغيار الحساسة وجاهزية الفرق المؤهلة لاستمرارية وموثوقية التشغيل.',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 8,
      title: 'حصر الصيانة بالمؤهلين وتطبيق إجراءات العزل (Consignation)',
      description: 'منع أي تدخل تقني دون تأمين التجهيزات وتطبيق إجراءات العزل والتقفيل الكهربائي والميكانيكي من طرف عمال مؤهلين.',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'II',
      section_title: 'II. تنظيم وتسيير مصالح الصيانة',
      item_number: 9,
      title: 'تأمين المصاعد والتحكم في الدخول بالبطاقات الإلكترونية',
      description: 'منع دخول غير المرخص لهم إلى المصاعد وتركيب أجهزة التحكم في الولوج بواسطة البطاقات الإلكترونية (Badges).',
      target_category: 'hse',
      status: 'يتطلب تدخل',
    },

    // Section III: Caméras de surveillance et contrôle d'accès (3 points)
    {
      section_code: 'III',
      section_title: 'III. كاميرات المراقبة والتحكم في الدخول',
      item_number: 1,
      title: 'اقتناء وتركيب أنظمة المراقبة بالكاميرات',
      description: 'استكمال تجهيز المواقع غير المزودة بكاميرات مراقبة داخل ومحيط الصوامع في أقرب الآجال وفق الإجراءات التنظيمية.',
      target_category: 'hse',
      status: 'قيد التنفيذ',
    },
    {
      section_code: 'III',
      section_title: 'III. كاميرات المراقبة والتحكم في الدخول',
      item_number: 2,
      title: 'ربط المنظومات الجديدة بأنظمة GMES SIGONAZ',
      description: 'دراسة التوافق التقني وربط التجهيزات الجديدة مع أنظمة المراقبة بالكاميرات المثبتة مسبقاً من طرف تجمع GMES SIGONAZ.',
      target_category: 'maintenance',
      status: 'قيد التنفيذ',
    },
    {
      section_code: 'III',
      section_title: 'III. كاميرات المراقبة والتحكم في الدخول',
      item_number: 3,
      title: 'تغطية المداخل ومراكز الاستقبال والشحن وأبراج العمل',
      description: 'توجيه عناية خاصة لمراقبة المداخل الرئيسية، حفر الاستقبال والشحن، أبراج العمل، والمناطق الحساسة للمنشآت.',
      target_category: 'hse',
      status: 'مطابق',
    },

    // Section IV: Mesures complémentaires (12 points)
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 1,
      title: 'الوقاية من انفجارات الغبار (ATEX)',
      description: 'مراقبة دائمة لتراكم الغبار بالمناطق الحساسة وصيانة أجهزة إزالة الغبار وأنظمة الحماية من الانفجار المدمجة في التجهيزات.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 2,
      title: 'مراقبة درجات حرارة الحبوب المخزنة',
      description: 'التأكد من سلامة كوابل قياس الحرارة (Câbles thermométriques) ومتابعة القراءات لرصد أي ارتفاع غير طبيعي أو سخونة.',
      target_category: 'smoke',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 3,
      title: 'الوقاية من الحرائق ومراقبة مصادر السخونة',
      description: 'الفحص الدوري للتجهيزات الكهربائية والمحركات والمدحرجات والكراسي وأعضاء النقل التي قد تشكل مصادر سخونة.',
      target_category: 'smoke',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 4,
      title: 'أمن الفضاءات المحصورة (Espaces confinés)',
      description: 'منع الدخول إلى الخلايا والحفر والأروقة دون ترخيص مسبق وفحص الجو ومراقبة خارجية دائمة مع منع التدخل الفردي.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 5,
      title: 'الوقاية من حوادث التجهيزات والأعضاء المتحركة',
      description: 'التأكد من وجود واقيات الحماية على الأعضاء المتحركة وسهولة الوصول إلى أزرار التوقف الاستعجالي وفحصها دورياً.',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 6,
      title: 'الوقاية من مخاطر الانطمار داخل الخلايا',
      description: 'المنع الصارم لأي تدخل داخل الخلايا والصوامع أثناء حركة الحبوب أو في ظروف قد تعرض العمال للانطمار.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 7,
      title: 'مراقبة عمليات المعالجة والتبخير (Fumigation)',
      description: 'حصر عمليات التبخير والمعالجة بفرق مؤهلة ومرخصة مع التقيد الصارم بإجراءات السلامة ومراقبة تعرض العمال.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 8,
      title: 'إعداد مخطط الطوارئ وتمارين المحاكاة',
      description: 'وضع مخطط تدخل للحريق والانفجار والحوادث بالتنسيق مع الحماية المدنية وتنظيم تمارين إخلاء ومحاكاة دورية.',
      target_category: 'hse',
      status: 'يتطلب تدخل',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 9,
      title: 'دورات التكوين المستمر والتحسيس للعمال',
      description: 'برمجة حصص دورية حول مخاطر الغبار القابل للاشتعال، تعليمات الإخلاء، استعمال معدات الوقاية، وإجراءات الإنذار.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 10,
      title: 'مراقبة عمليات الاستقبال والشحن',
      description: 'احترام قواعد السلامة أثناء التفريغ والشحن والمناولة خاصة عند حفر الاستقبال وتجهيزات النقل.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 11,
      title: 'حماية وفحص المنشآت الخرسانية المسلحة',
      description: 'التفتيش الدوري لهياكل الخلايا والأروقة وأبراج العمل والملحقات لرصد أي تشققات أو تسربات أو خلل إنشائي.',
      target_category: 'maintenance',
      status: 'مطابق',
    },
    {
      section_code: 'IV',
      section_title: 'IV. التدابير التكميلية للوقاية وتأمين المنشآت',
      item_number: 12,
      title: 'برنامج مراقبة ومكافحة الآفات والقوارض',
      description: 'تطبيق برنامج منتظم لمكافحة القوارض والحشرات والآفات لحماية الجودة الصحية للحبوب المخزنة.',
      target_category: 'hse',
      status: 'مطابق',
    },

    // Section V: Suivi et contrôle (3 points)
    {
      section_code: 'V',
      section_title: 'V. المتابعة ومراقبة تطبيق التدابير',
      item_number: 1,
      title: 'تعيين مسؤول مكلف بمتابعة الأمن والنظافة والصيانة',
      description: 'تعيين مسؤول رسمي مكلف بمتابعة تطبيق تدابير النظافة والأمن والصيانة على مستوى كل موقع.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'V',
      section_title: 'V. المتابعة ومراقبة تطبيق التدابير',
      item_number: 2,
      title: 'مسك سجل المتابعة اليومي للتدقيق والتدخلات',
      description: 'تدوين عمليات المراقبة اليومية، الاختلالات المسجلة، التدخلات المنجزة، والإجراءات التصحيحية المتخذة.',
      target_category: 'hse',
      status: 'مطابق',
    },
    {
      section_code: 'V',
      section_title: 'V. المتابعة ومراقبة تطبيق التدابير',
      item_number: 3,
      title: 'زيارات التفتيش والمراقبة الدورية الميدانية',
      description: 'تنظيم زيارات تفتيش ومراقبة لتقييم مدى التقدم في تطبيق التدابير ورصد النقائص واقتراح الحلول التصحيحية.',
      target_category: 'hse',
      status: 'قيد التنفيذ',
    },
  ];

  const insertDirective = db.prepare(`
    INSERT INTO directive_items (section_code, section_title, item_number, title, description, target_category, facility, status, responsible, last_checked, notes)
    VALUES (@section_code, @section_title, @item_number, @title, @description, @target_category, 'مركب عين مليلة', @status, 'لطفي محمد بلغربي', @last_checked, '')
  `);

  const tx = db.transaction(() => {
    for (const p of points) {
      insertDirective.run({ ...p, last_checked: today });
    }
  });

  tx();
}

function seedEmployees(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM employees').get() as { total: number };
  if (countRow.total > 0) return;

  db.prepare(`
    INSERT INTO employees (name, password, role, facility, is_admin)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'لطفي محمد بلغربي',
    '2026',
    'مسؤول الأمن والوقاية (HSE)',
    'مركب عين مليلة',
    1
  );
}

function seedFacilitiesConfig(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM facilities_config').get() as { total: number };
  if (countRow.total > 0) return;

  const defaults: Array<{ name: string; search_query: string }> = [
    { name: 'مركب طاقزة', search_query: 'Tagza, Ain Mlila, Oum El Bouaghi, Algeria' },
    { name: 'مركب عين مليلة', search_query: 'Ain Mlila, Oum El Bouaghi, Algeria' },
    { name: 'وحدة سيڨوس', search_query: 'Sigus, Oum El Bouaghi, Algeria' },
    { name: 'وحدة عين فكرون', search_query: 'Ain Fakroun, Oum El Bouaghi, Algeria' },
    { name: 'وحدة عين كرشة', search_query: 'Ain Kercha, Oum El Bouaghi, Algeria' },
    { name: 'وحدة سوق نعمان', search_query: 'Souk Naamane, Oum El Bouaghi, Algeria' },
    { name: 'وحدة بئر الشهداء', search_query: 'Bir Chouhada, Oum El Bouaghi, Algeria' },
    { name: 'محطة بذور أولاد حملة', search_query: 'Ouled Hamla, Oum El Bouaghi, Algeria' },
    { name: 'المركز الجواري بئر الشهداء', search_query: 'Bir Chouhada, Oum El Bouaghi, Algeria' },
    { name: 'المركز الجواري عين مليلة', search_query: 'Ain Mlila, Oum El Bouaghi, Algeria' },
    { name: 'المركز الجواري بوغرارة السعودي', search_query: 'Boughrara Saoudi, Oum El Bouaghi, Algeria' },
    { name: 'المركز الجواري هنشير تومغني', search_query: 'Henchir Toumghani, Oum El Bouaghi, Algeria' },
  ];

  const insertFac = db.prepare(`
    INSERT INTO facilities_config (name, search_query, lat, lng, address)
    VALUES (?, ?, NULL, NULL, ?)
  `);

  const tx = db.transaction(() => {
    for (const f of defaults) {
      insertFac.run(f.name, f.search_query, f.search_query);
    }
  });
  tx();
}

seedInitialData();
seedDirectiveChecklist();
seedEmployees();
seedFacilitiesConfig();

function seedFireMotors(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM fire_motors').get() as { total: number };
  if (countRow.total > 0) return;

  const today = formatOffsetDate(0);
  const items = [
    {
      motor_code: 'PMP-ML-01',
      motor_name: 'المضخة الكهربائية الرئيسية للحريق 1',
      facility: 'مركب عين مليلة',
      power_kw: 45,
      pressure_bar: 8.5,
      status: 'تعمل',
      last_test_date: formatOffsetDate(-5),
      notes: 'اختبار الضغط الأسبوعي ناجح والمولد الاحتياطي مربوط تلقائياً',
    },
    {
      motor_code: 'PMP-ML-02',
      motor_name: 'مضخة الجوكي لتثبيت الضغط (Jockey Pump)',
      facility: 'مركب عين مليلة',
      power_kw: 7.5,
      pressure_bar: 9.0,
      status: 'تعمل',
      last_test_date: formatOffsetDate(-2),
      notes: 'تحافظ على استقرار الضغط داخل شبكة الصوامع',
    },
    {
      motor_code: 'PMP-TG-01',
      motor_name: 'مضخة مكافحة الحريق الكهربائية A',
      facility: 'مركب طاقزة',
      power_kw: 37,
      pressure_bar: 6.2,
      status: 'صيانة',
      last_test_date: formatOffsetDate(-12),
      notes: 'تبديل الحشوة الميكانيكية وفحص لوحة التغذية MCC',
    },
    {
      motor_code: 'PMP-AF-01',
      motor_name: 'محرك الضخ الاحتياطي للوحدة',
      facility: 'وحدة عين فكرون',
      power_kw: 30,
      pressure_bar: 0,
      status: 'عطب',
      last_test_date: today,
      notes: 'عطب في قاطع البدء النجمي-المثلثي ويتطلب استبدال الكونتاكتور',
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO fire_motors (motor_code, motor_name, facility, power_kw, pressure_bar, status, last_test_date, notes, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'لطفي محمد بلغربي')
  `);
  const tx = db.transaction(() => {
    for (const m of items) {
      stmt.run(m.motor_code, m.motor_name, m.facility, m.power_kw, m.pressure_bar, m.status, m.last_test_date, m.notes);
    }
  });
  tx();
}

function seedWaterTanks(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM water_tanks').get() as { total: number };
  if (countRow.total > 0) return;

  const today = formatOffsetDate(0);
  const items = [
    {
      tank_code: 'TNK-ML-01',
      tank_name: 'الخزان الرئيسي لمكافحة الحريق (أرضي)',
      facility: 'مركب عين مليلة',
      capacity_m3: 250,
      current_m3: 220,
      min_safe_m3: 100,
      last_inspection: formatOffsetDate(-3),
      notes: 'مملوء ومزود بصمام تعويض أوتوماتيكي',
    },
    {
      tank_code: 'TNK-TG-01',
      tank_name: 'خزان الحماية من الحريق - الصوامع',
      facility: 'مركب طاقزة',
      capacity_m3: 180,
      current_m3: 145,
      min_safe_m3: 75,
      last_inspection: formatOffsetDate(-4),
      notes: 'العوامة وصمام السحب في حالة جيدة',
    },
    {
      tank_code: 'TNK-OH-01',
      tank_name: 'خزان المياه الاحتياطي لمحطة البذور',
      facility: 'محطة بذور أولاد حملة',
      capacity_m3: 120,
      current_m3: 42,
      min_safe_m3: 60,
      last_inspection: today,
      notes: 'تنبيه: المستوى أقل من الحد الأدنى الآمن ويتطلب إعادة ملء عاجلة',
    },
    {
      tank_code: 'TNK-AF-01',
      tank_name: 'خزان شبكة الإطفاء - عين فكرون',
      facility: 'وحدة عين فكرون',
      capacity_m3: 120,
      current_m3: 98,
      min_safe_m3: 50,
      last_inspection: formatOffsetDate(-6),
      notes: 'مخزون آمن وجاهز للتدخل',
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO water_tanks (tank_code, tank_name, facility, capacity_m3, current_m3, min_safe_m3, last_inspection, notes, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'لطفي محمد بلغربي')
  `);
  const tx = db.transaction(() => {
    for (const w of items) {
      stmt.run(w.tank_code, w.tank_name, w.facility, w.capacity_m3, w.current_m3, w.min_safe_m3, w.last_inspection, w.notes);
    }
  });
  tx();
}

function seedSecurityConfig(): void {
  const existing = db.prepare('SELECT id FROM security_config WHERE id = 1').get();
  if (!existing) {
    db.prepare(`
      INSERT INTO security_config (id, supervisor_name, supervisor_phone, sms_alert_enabled, sms_webhook_url)
      VALUES (1, 'لطفي محمد بلغربي', '', 1, '')
    `).run();
  }
}

function seedAppAlarms(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM app_alarms').get() as { total: number };
  if (countRow.total > 0) return;
  const today = formatOffsetDate(0);
  const items = [
    {
      title: 'فحص دوري لمضخات الحريق وخزانات المياه (m³)',
      message: 'التحقق من جاهزية المحركات الكهربائية ومستوى احتياطي المياه عبر الوحدات',
      facility: 'مركب عين مليلة',
      due_datetime: `${today}T08:30`,
      repeat_cycle: 'يومي',
    },
    {
      title: 'متابعة نقاط المذكرة الوقائية 488 المجدولة',
      message: 'مراجعة النقاط المكتوبة قيد التنفيذ وتحديث حالة المطابقة',
      facility: 'جميع الهياكل',
      due_datetime: `${today}T10:00`,
      repeat_cycle: 'أسبوعي',
    },
  ];
  const stmt = db.prepare(`
    INSERT INTO app_alarms (title, message, facility, due_datetime, repeat_cycle, sound_enabled, is_active, acknowledged, created_by)
    VALUES (?, ?, ?, ?, ?, 1, 1, 0, 'لطفي محمد بلغربي')
  `);
  for (const a of items) {
    stmt.run(a.title, a.message, a.facility, a.due_datetime, a.repeat_cycle);
  }
}

seedFireMotors();
seedWaterTanks();
seedSecurityConfig();
seedAppAlarms();

function detectDeviceType(req: Request): string {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (/android|iphone|ipad|ipod|mobile|blackberry|iemobile|opera mini/.test(ua)) {
    return 'هاتف ذكي (Phone)';
  }
  return 'حاسوب (PC)';
}

function logActivity(
  recordId: number | null,
  action: 'إضافة' | 'تحديث' | 'تجديد' | 'حذف',
  recordType: string,
  facility: string,
  summary: string,
  actor: string
): void {
  db.prepare(`
    INSERT INTO activity_logs (record_id, action, record_type, facility, summary, actor)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(recordId, action, recordType, facility, summary, actor || 'موظف التعاونية');
}

function recordStorageSnapshot(
  actionLabel: string,
  category: string,
  reqOrDevice: Request | string,
  summary: string,
  actor = 'لطفي محمد بلغربي'
) {
  const deviceType = typeof reqOrDevice === 'string' ? reqOrDevice : detectDeviceType(reqOrDevice);
  const recRow = db.prepare('SELECT COUNT(*) as total FROM records').get() as { total: number };
  const motRow = db.prepare('SELECT COUNT(*) as total FROM fire_motors').get() as { total: number };
  const tnkRow = db.prepare('SELECT COUNT(*) as total FROM water_tanks').get() as { total: number };

  const info = db.prepare(`
    INSERT INTO storage_snapshots (action_label, category, device_type, record_count, motor_count, tank_count, summary, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actionLabel,
    category,
    deviceType,
    recRow.total,
    motRow.total,
    tnkRow.total,
    summary,
    actor || 'لطفي محمد بلغربي'
  );

  return db.prepare('SELECT * FROM storage_snapshots WHERE id = ?').get(info.lastInsertRowid);
}

app.get('/api/config', (_req: Request, res: Response) => {
  const mapsApiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  res.json({ mapsApiKey });
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { name, password } = req.body as {
    name?: string;
    password?: string;
  };

  const normalizedName = (name || '').trim().replace(/\s+/g, ' ');

  if (!normalizedName || !password) {
    res.status(400).json({ error: 'يرجى إدخال اسم الموظف وكلمة السر' });
    return;
  }

  const emp = db
    .prepare('SELECT id, name, password, role, is_admin FROM employees WHERE name = ?')
    .get(normalizedName) as
    | { id: number; name: string; password: string; role: string; is_admin: number }
    | undefined;

  if (!emp || emp.password !== password) {
    const deviceType = detectDeviceType(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 260);
    const ip = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();

    const secCfg = db
      .prepare('SELECT supervisor_name, supervisor_phone, sms_alert_enabled, sms_webhook_url FROM security_config WHERE id = 1')
      .get() as
      | {
          supervisor_name: string;
          supervisor_phone: string;
          sms_alert_enabled: number;
          sms_webhook_url: string;
        }
      | undefined;

    const targetSupervisor = secCfg?.supervisor_name || 'لطفي محمد بلغربي';
    const targetPhone = (secCfg?.supervisor_phone || '').trim();
    const attemptedLabel = normalizedName || 'غير معروف';
    const timestampStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const smsMessage = `تنبيه أمني CCLS عين مليلة: محاولة دخول غير مصرح بها باسم "${attemptedLabel}" عبر ${deviceType} بتاريخ ${timestampStr}.`;

    let smsStatus = 'مسجل في التنبيهات';
    const webhookUrl = (process.env.SMS_WEBHOOK_URL || secCfg?.sms_webhook_url || '').trim();

    if (!targetPhone) {
      smsStatus = 'مسجل في النظام (يرجى إضافة رقم هاتف المسؤول الأول)';
    } else if (secCfg?.sms_alert_enabled !== 1) {
      smsStatus = 'مسجل (إشعارات SMS معطلة في الإعدادات)';
    } else if (webhookUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const hookRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: targetPhone,
            supervisor: targetSupervisor,
            message: smsMessage,
            attemptedName: attemptedLabel,
            deviceType,
            ipAddress: ip,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        smsStatus = hookRes.ok
          ? `تم إرسال SMS إلى ${targetPhone}`
          : `فشل إرسال البوابة (${hookRes.status}) — محفوظ في السجل`;
      } catch {
        smsStatus = 'تعذر الاتصال ببوابة SMS — محفوظ في السجل';
      }
    } else {
      smsStatus = `جاهز للإرسال إلى ${targetPhone} (يمكن الإرسال المباشر عبر SMS أو ربط بوابة)`;
    }

    db.prepare(`
      INSERT INTO intruder_alerts (attempted_name, device_type, user_agent, ip_address, target_supervisor, target_phone, sms_status, sms_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(attemptedLabel, deviceType, ua, ip, targetSupervisor, targetPhone, smsStatus, smsMessage);

    recordStorageSnapshot(
      'تنبيه متطفل',
      'security',
      deviceType,
      `رصد محاولة دخول مرفوضة (${attemptedLabel})`,
      'نظام الحماية'
    );

    res.status(401).json({
      error: 'اسم الموظف أو كلمة السر غير صحيحة — تم تسجيل المحاولة وإخطار المسؤول الأول',
      intruderLogged: true,
    });
    return;
  }

  res.json({
    authenticated: true,
    employee: {
      id: emp.id,
      name: emp.name,
      role: emp.role,
      is_admin: emp.is_admin,
    },
  });
});

app.post('/api/auth/change-password', (req: Request, res: Response) => {
  const { employeeId, name, currentPassword, newPassword } = req.body as {
    employeeId?: number;
    name?: string;
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword || newPassword.trim().length < 4) {
    res.status(400).json({ error: 'كلمة السر الجديدة يجب أن تتكون من 4 أحرف على الأقل' });
    return;
  }

  const emp = (employeeId
    ? db.prepare('SELECT id, name, password FROM employees WHERE id = ?').get(employeeId)
    : db.prepare('SELECT id, name, password FROM employees WHERE name = ?').get((name || '').trim())
  ) as { id: number; name: string; password: string } | undefined;

  if (!emp) {
    res.status(404).json({ error: 'حساب الموظف غير موجود' });
    return;
  }

  if (emp.password !== currentPassword) {
    res.status(401).json({ error: 'كلمة السر الحالية غير صحيحة' });
    return;
  }

  db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(newPassword, emp.id);
  logActivity(emp.id, 'تحديث', 'hse', 'مركب عين مليلة', `تبديل كلمة السر (${emp.name})`, emp.name);
  recordStorageSnapshot('تبديل كلمة السر', 'security', req, `تحديث كلمة سر: ${emp.name}`, emp.name);
  res.json({ success: true });
});

app.get('/api/employees', (_req: Request, res: Response) => {
  const rows = db
    .prepare('SELECT id, name, role, facility, is_admin, created_at FROM employees ORDER BY id ASC')
    .all();
  res.json(rows);
});

app.post('/api/employees', (req: Request, res: Response) => {
  const {
    name,
    password,
    role = 'مسؤول الأمن والوقاية (HSE)',
    facility = 'مركب عين مليلة',
    is_admin = 0,
    actor = 'لطفي محمد بلغربي',
  } = req.body as {
    name?: string;
    password?: string;
    role?: string;
    facility?: string;
    is_admin?: number;
    actor?: string;
  };

  const cleanName = (name || '').trim().replace(/\s+/g, ' ');
  if (!cleanName || !password || password.trim().length < 4) {
    res.status(400).json({ error: 'يرجى إدخال اسم الموظف وكلمة سر صالحة (4 أحرف على الأقل)' });
    return;
  }

  const existing = db.prepare('SELECT id FROM employees WHERE name = ?').get(cleanName);
  if (existing) {
    res.status(409).json({ error: 'اسم الموظف مسجل مسبقاً' });
    return;
  }

  const info = db
    .prepare('INSERT INTO employees (name, password, role, facility, is_admin) VALUES (?, ?, ?, ?, ?)')
    .run(cleanName, password, String(role).trim(), String(facility).trim(), is_admin ? 1 : 0);

  const created = db
    .prepare('SELECT id, name, role, facility, is_admin, created_at FROM employees WHERE id = ?')
    .get(info.lastInsertRowid);

  logActivity(Number(info.lastInsertRowid), 'إضافة', 'hse', String(facility), `إضافة موظف: ${cleanName}`, actor);
  recordStorageSnapshot('إضافة موظف', 'employees', req, `${cleanName} · ${String(facility)}`, actor);
  res.status(201).json({ employee: created, success: true });
});

app.delete('/api/employees/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare('SELECT id, name, facility, is_admin FROM employees WHERE id = ?')
    .get(id) as { id: number; name: string; facility: string; is_admin: number } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'الموظف غير موجود' });
    return;
  }

  if (existing.is_admin === 1) {
    const adminCount = db
      .prepare('SELECT COUNT(*) as total FROM employees WHERE is_admin = 1')
      .get() as { total: number };
    if (adminCount.total <= 1) {
      res.status(400).json({ error: 'لا يمكن حذف المسؤول الرئيسي الوحيد في النظام' });
      return;
    }
  }

  const actor = String(req.query.actor || 'لطفي محمد بلغربي');
  db.prepare('DELETE FROM employees WHERE id = ?').run(id);
  logActivity(id, 'حذف', 'hse', existing.facility, `حذف حساب الموظف: ${existing.name}`, actor);
  recordStorageSnapshot('حذف موظف', 'employees', req, `حذف حساب: ${existing.name}`, actor);
  res.json({ success: true });
});

app.get('/api/records', (req: Request, res: Response) => {
  const { type, facility, q } = req.query as {
    type?: string;
    facility?: string;
    q?: string;
  };

  let sql = 'SELECT * FROM records WHERE 1=1';
  const params: string[] = [];

  if (type && type !== 'all') {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (facility && facility !== 'all') {
    sql += ' AND facility = ?';
    params.push(facility);
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    sql += ' AND (field1 LIKE ? OR field2 LIKE ? OR facility LIKE ? OR responsible LIKE ? OR notes LIKE ?)';
    params.push(like, like, like, like, like);
  }

  sql += ' ORDER BY id DESC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.get('/api/records/:type', (req: Request, res: Response) => {
  const { type } = req.params;
  const rows = db.prepare('SELECT * FROM records WHERE type = ? ORDER BY id DESC').all(type);
  res.json(rows);
});

app.post('/api/records', (req: Request, res: Response) => {
  const {
    type,
    field1,
    field2,
    ext_type = '',
    ext_kg = '',
    facility,
    start_date,
    end_date,
    priority = 'عادي',
    responsible = '',
    notes = '',
    manual_status = 'auto',
    actor = 'لطفي محمد بلغربي',
  } = req.body;

  if (!type || !field1 || !field2 || !facility || !start_date || !end_date) {
    res.status(400).json({ error: 'جميع الحقول الأساسية مطلوبة' });
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO records (type, field1, field2, ext_type, ext_kg, facility, start_date, end_date, priority, responsible, notes, manual_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    type,
    String(field1).trim(),
    String(field2).trim(),
    String(ext_type).trim(),
    String(ext_kg).trim(),
    facility,
    start_date,
    end_date,
    priority,
    String(responsible).trim(),
    String(notes).trim(),
    manual_status
  );

  const created = db.prepare('SELECT * FROM records WHERE id = ?').get(info.lastInsertRowid);
  logActivity(Number(info.lastInsertRowid), 'إضافة', type, facility, String(field1).trim(), actor);
  recordStorageSnapshot('إضافة سجل', String(type), req, `${String(field1).trim()} · ${facility}`, String(actor));

  res.status(201).json({ id: info.lastInsertRowid, record: created, success: true });
});

app.put('/api/records/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'السجل غير موجود' });
    return;
  }

  const {
    type = existing.type,
    field1 = existing.field1,
    field2 = existing.field2,
    ext_type = existing.ext_type ?? '',
    ext_kg = existing.ext_kg ?? '',
    facility = existing.facility,
    start_date = existing.start_date,
    end_date = existing.end_date,
    priority = existing.priority,
    responsible = existing.responsible,
    notes = existing.notes,
    manual_status = existing.manual_status,
    actor = 'لطفي محمد بلغربي',
  } = req.body;

  db.prepare(`
    UPDATE records
    SET type = ?, field1 = ?, field2 = ?, ext_type = ?, ext_kg = ?, facility = ?, start_date = ?, end_date = ?,
        priority = ?, responsible = ?, notes = ?, manual_status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    type,
    String(field1).trim(),
    String(field2).trim(),
    String(ext_type).trim(),
    String(ext_kg).trim(),
    facility,
    start_date,
    end_date,
    priority,
    String(responsible).trim(),
    String(notes).trim(),
    manual_status,
    id
  );

  const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  logActivity(id, 'تحديث', String(type), String(facility), String(field1).trim(), actor);
  recordStorageSnapshot('تحديث سجل', String(type), req, `${String(field1).trim()} · ${facility}`, String(actor));

  res.json({ record: updated, success: true });
});

app.get('/api/directives', (req: Request, res: Response) => {
  const { section, status, facility } = req.query as {
    section?: string;
    status?: string;
    facility?: string;
  };

  let sql = 'SELECT * FROM directive_items WHERE 1=1';
  const params: string[] = [];

  if (section && section !== 'all') {
    sql += ' AND section_code = ?';
    params.push(section);
  }
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (facility && facility !== 'all') {
    sql += ' AND facility = ?';
    params.push(facility);
  }

  sql += ' ORDER BY section_code ASC, item_number ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

function computeNextDueDate(baseDate: string, periodicity: string): string {
  const daysMap: Record<string, number> = {
    يومي: 1,
    أسبوعي: 7,
    شهري: 30,
    'ربع سنوي': 90,
    سنوي: 365,
  };
  const addDays = daysMap[periodicity] || 0;
  if (!addDays) return baseDate;
  const d = baseDate ? new Date(baseDate) : new Date();
  if (Number.isNaN(d.getTime())) return formatOffsetDate(addDays);
  d.setDate(d.getDate() + addDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const SECTION_TITLES_MAP: Record<string, string> = {
  I: 'النظافة والأمن والبيئة (HSE)',
  II: 'تنظيم وتسيير مصالح الصيانة',
  III: 'كاميرات المراقبة والتحكم في الدخول',
  IV: 'التدابير التكميلية للوقاية وتأمين المنشآت',
  V: 'المتابعة ومراقبة تطبيق التدابير',
};

app.post('/api/directives', (req: Request, res: Response) => {
  const {
    section_code = 'V',
    title,
    description = '',
    target_category = 'hse',
    facility = 'مركب عين مليلة',
    status = 'قيد التنفيذ',
    periodicity = 'أسبوعي',
    next_due_date = formatOffsetDate(7),
    alarm_enabled = 1,
    responsible = 'لطفي محمد بلغربي',
    notes = '',
    actor = 'لطفي محمد بلغربي',
  } = req.body as Record<string, unknown>;

  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) {
    res.status(400).json({ error: 'عنوان النقطة المكتوبة مطلوب' });
    return;
  }

  const secCode = ['I', 'II', 'III', 'IV', 'V'].includes(String(section_code))
    ? String(section_code)
    : 'V';
  const maxRow = db
    .prepare('SELECT COALESCE(MAX(item_number), 0) as maxNum FROM directive_items WHERE section_code = ?')
    .get(secCode) as { maxNum: number };
  const nextNum = Number(maxRow?.maxNum || 0) + 1;
  const secTitle = SECTION_TITLES_MAP[secCode] || SECTION_TITLES_MAP.V;

  const info = db.prepare(`
    INSERT INTO directive_items (
      section_code, section_title, item_number, title, description, target_category,
      facility, status, responsible, last_checked, notes, periodicity, next_due_date, alarm_enabled, is_custom
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    secCode,
    secTitle,
    nextNum,
    cleanTitle,
    String(description || cleanTitle).trim(),
    String(target_category || 'hse'),
    String(facility || 'مركب عين مليلة').trim(),
    String(status || 'قيد التنفيذ'),
    String(responsible || actor).trim(),
    formatOffsetDate(0),
    String(notes || '').trim(),
    String(periodicity || 'أسبوعي'),
    String(next_due_date || formatOffsetDate(7)),
    alarm_enabled ? 1 : 0
  );

  const created = db.prepare('SELECT * FROM directive_items WHERE id = ?').get(info.lastInsertRowid);
  logActivity(Number(info.lastInsertRowid), 'إضافة', String(target_category), String(facility), `نقطة مكتوبة: ${cleanTitle}`, String(actor));
  recordStorageSnapshot('إضافة نقطة مكتوبة', 'directive', req, `${cleanTitle} (${String(periodicity)})`, String(actor));
  res.status(201).json({ item: created, success: true });
});

app.put('/api/directives/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM directive_items WHERE id = ?').get(id) as
    | {
        id: number;
        section_code: string;
        section_title: string;
        title: string;
        description: string;
        facility: string;
        target_category: string;
        status: string;
        responsible: string;
        notes: string;
        periodicity: string;
        next_due_date: string;
        alarm_enabled: number;
      }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'البند غير موجود' });
    return;
  }

  const {
    title = existing.title,
    description = existing.description,
    section_code = existing.section_code,
    status = existing.status,
    facility = existing.facility,
    responsible = existing.responsible,
    notes = existing.notes,
    periodicity = existing.periodicity || 'شهري',
    next_due_date = existing.next_due_date || '',
    alarm_enabled = existing.alarm_enabled ?? 1,
    markChecked = false,
    actor = 'لطفي محمد بلغربي',
  } = req.body as Record<string, unknown>;

  const today = formatOffsetDate(0);
  const cleanSection = ['I', 'II', 'III', 'IV', 'V'].includes(String(section_code))
    ? String(section_code)
    : existing.section_code;
  const secTitle = SECTION_TITLES_MAP[cleanSection] || existing.section_title;
  const computedDue = markChecked
    ? computeNextDueDate(today, String(periodicity || 'شهري'))
    : String(next_due_date || '');

  db.prepare(`
    UPDATE directive_items
    SET section_code = ?, section_title = ?, title = ?, description = ?,
        status = ?, facility = ?, responsible = ?, notes = ?, last_checked = ?,
        periodicity = ?, next_due_date = ?, alarm_enabled = ?
    WHERE id = ?
  `).run(
    cleanSection,
    secTitle,
    String(title).trim(),
    String(description).trim(),
    String(status),
    String(facility),
    String(responsible).trim(),
    String(notes).trim(),
    today,
    String(periodicity || 'شهري'),
    computedDue,
    alarm_enabled ? 1 : 0,
    id
  );

  const updated = db.prepare('SELECT * FROM directive_items WHERE id = ?').get(id);
  logActivity(id, 'تحديث', existing.target_category, String(facility), `${String(title).trim()} (${String(status)})`, String(actor));
  recordStorageSnapshot(
    markChecked ? 'متابعة دورية للنقطة' : 'تحديث نقطة مكتوبة',
    'directive',
    req,
    `${String(title).trim()} (${String(status)})`,
    String(actor)
  );

  res.json({ item: updated, success: true });
});

app.delete('/api/directives/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, title, facility, target_category FROM directive_items WHERE id = ?').get(id) as
    | { id: number; title: string; facility: string; target_category: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'البند غير موجود' });
    return;
  }
  const actor = String(req.query.actor || 'لطفي محمد بلغربي');
  db.prepare('DELETE FROM directive_items WHERE id = ?').run(id);
  logActivity(id, 'حذف', existing.target_category, existing.facility, `حذف نقطة: ${existing.title}`, actor);
  recordStorageSnapshot('حذف نقطة مكتوبة', 'directive', req, `حذف: ${existing.title}`, actor);
  res.json({ success: true });
});

app.post('/api/directives/bulk', (req: Request, res: Response) => {
  const { items: incoming, actor = 'لطفي محمد بلغربي' } = req.body as {
    items?: Array<Record<string, unknown>>;
    actor?: string;
  };
  if (!Array.isArray(incoming) || incoming.length === 0) {
    res.status(400).json({ error: 'قائمة النقاط فارغة' });
    return;
  }

  const today = formatOffsetDate(0);
  const insertStmt = db.prepare(`
    INSERT INTO directive_items (
      section_code, section_title, item_number, title, description, target_category,
      facility, status, responsible, last_checked, notes, periodicity, next_due_date, alarm_enabled, is_custom
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  let insertedCount = 0;
  const tx = db.transaction(() => {
    for (const row of incoming) {
      const title = String(row.title || '').trim();
      if (!title) continue;
      const secCode = ['I', 'II', 'III', 'IV', 'V'].includes(String(row.section_code))
        ? String(row.section_code)
        : 'V';
      const maxRow = db
        .prepare('SELECT COALESCE(MAX(item_number), 0) as maxNum FROM directive_items WHERE section_code = ?')
        .get(secCode) as { maxNum: number };
      const nextNum = Number(maxRow?.maxNum || 0) + 1;
      const periodicity = String(row.periodicity || 'أسبوعي');
      const nextDue = String(row.next_due_date || computeNextDueDate(today, periodicity));

      insertStmt.run(
        secCode,
        SECTION_TITLES_MAP[secCode] || SECTION_TITLES_MAP.V,
        nextNum,
        title,
        String(row.description || title).trim(),
        String(row.target_category || 'hse'),
        String(row.facility || 'مركب عين مليلة').trim(),
        String(row.status || 'قيد التنفيذ'),
        String(row.responsible || actor).trim(),
        today,
        String(row.notes || '').trim(),
        periodicity,
        nextDue,
        1
      );
      insertedCount++;
    }
    if (insertedCount > 0) {
      logActivity(null, 'إضافة', 'hse', 'جميع الهياكل', `استيراد نقاط مكتوبة من Excel (${insertedCount})`, actor);
    }
  });
  tx();
  if (insertedCount > 0) {
    recordStorageSnapshot('استيراد Excel (نقاط)', 'directive', req, `استيراد ${insertedCount} نقطة مكتوبة`, actor);
  }
  res.status(201).json({ inserted: insertedCount, success: true });
});

app.post('/api/records/:id/renew', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as
    | { id: number; type: string; field1: string; facility: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'السجل غير موجود' });
    return;
  }

  const months = Number(req.body?.months || 12);
  const actor = String(req.body?.actor || 'موظف التعاونية');
  const today = new Date();
  const startDate = formatOffsetDate(0);
  const endObj = new Date(today);
  endObj.setMonth(endObj.getMonth() + months);
  const endDate = `${endObj.getFullYear()}-${String(endObj.getMonth() + 1).padStart(2, '0')}-${String(endObj.getDate()).padStart(2, '0')}`;

  db.prepare(`
    UPDATE records
    SET start_date = ?, end_date = ?, manual_status = 'auto', updated_at = datetime('now')
    WHERE id = ?
  `).run(startDate, endDate, id);

  const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  logActivity(id, 'تجديد', existing.type, existing.facility, `${existing.field1} (+${months} شهر)`, actor);
  recordStorageSnapshot('تجديد صلاحية', existing.type, req, `${existing.field1} (+${months} شهر)`, actor);

  res.json({ record: updated, success: true });
});

app.delete('/api/records/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as
    | { id: number; type: string; field1: string; facility: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'السجل غير موجود' });
    return;
  }

  const actor = String(req.query.actor || 'موظف التعاونية');
  const info = db.prepare('DELETE FROM records WHERE id = ?').run(id);
  logActivity(id, 'حذف', existing.type, existing.facility, existing.field1, actor);
  recordStorageSnapshot('حذف سجل', existing.type, req, `حذف: ${existing.field1}`, actor);

  res.json({ deleted: info.changes, success: true });
});

app.post('/api/records/bulk', (req: Request, res: Response) => {
  const { records: incoming, actor = 'لطفي محمد بلغربي' } = req.body as {
    records?: Array<{
      type?: string;
      field1?: string;
      field2?: string;
      ext_type?: string;
      ext_kg?: string;
      facility?: string;
      start_date?: string;
      end_date?: string;
      priority?: string;
      responsible?: string;
      notes?: string;
      manual_status?: string;
    }>;
    actor?: string;
  };

  if (!Array.isArray(incoming) || incoming.length === 0) {
    res.status(400).json({ error: 'قائمة السجلات فارغة' });
    return;
  }

  const insertStmt = db.prepare(`
    INSERT INTO records (type, field1, field2, ext_type, ext_kg, facility, start_date, end_date, priority, responsible, notes, manual_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const today = formatOffsetDate(0);
  const nextYear = formatOffsetDate(365);
  let insertedCount = 0;
  let primaryType = 'extinguishers';

  const tx = db.transaction(() => {
    for (const row of incoming) {
      const f1 = String(row.field1 || '').trim();
      if (!f1) continue;
      const rowType = String(row.type || 'extinguishers');
      primaryType = rowType;
      insertStmt.run(
        rowType,
        f1,
        String(row.field2 || 'مسجل عبر ملف Excel').trim(),
        String(row.ext_type || (rowType === 'extinguishers' ? 'بودرة جافة ABC' : '')).trim(),
        String(row.ext_kg || (rowType === 'extinguishers' ? '9' : '')).trim(),
        String(row.facility || 'مركب عين مليلة').trim(),
        row.start_date || today,
        row.end_date || nextYear,
        row.priority || 'عادي',
        String(row.responsible || actor).trim(),
        String(row.notes || '').trim(),
        row.manual_status || 'auto'
      );
      insertedCount++;
    }
    if (insertedCount > 0) {
      logActivity(
        null,
        'إضافة',
        primaryType,
        'جميع الهياكل',
        `استيراد جماعي من Excel (${insertedCount} سجل · ${primaryType})`,
        actor
      );
    }
  });

  tx();
  if (insertedCount > 0) {
    recordStorageSnapshot('استيراد Excel', primaryType, req, `استيراد ${insertedCount} سجل (${primaryType})`, actor);
  }
  res.status(201).json({ inserted: insertedCount, success: true });
});

app.post('/api/motors/bulk', (req: Request, res: Response) => {
  const { motors: incoming, actor = 'لطفي محمد بلغربي' } = req.body as {
    motors?: Array<Record<string, unknown>>;
    actor?: string;
  };
  if (!Array.isArray(incoming) || incoming.length === 0) {
    res.status(400).json({ error: 'قائمة المحركات فارغة' });
    return;
  }

  const today = formatOffsetDate(0);
  const stmt = db.prepare(`
    INSERT INTO fire_motors (motor_code, motor_name, facility, power_kw, pressure_bar, status, last_test_date, notes, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let insertedCount = 0;
  const tx = db.transaction(() => {
    for (const row of incoming) {
      const code = String(row.motor_code || '').trim();
      const name = String(row.motor_name || '').trim();
      if (!code || !name) continue;
      const st = ['تعمل', 'عطب', 'صيانة'].includes(String(row.status)) ? String(row.status) : 'تعمل';
      stmt.run(
        code,
        name,
        String(row.facility || 'مركب عين مليلة').trim(),
        Math.max(0, Number(row.power_kw) || 0),
        Math.max(0, Number(row.pressure_bar) || 0),
        st,
        String(row.last_test_date || today),
        String(row.notes || '').trim(),
        actor
      );
      insertedCount++;
    }
    if (insertedCount > 0) {
      logActivity(null, 'إضافة', 'motors', 'جميع الهياكل', `استيراد محركات من Excel (${insertedCount})`, actor);
    }
  });
  tx();
  if (insertedCount > 0) {
    recordStorageSnapshot('استيراد Excel (محركات)', 'motors', req, `استيراد ${insertedCount} محرك إطفاء`, actor);
  }
  res.status(201).json({ inserted: insertedCount, success: true });
});

app.post('/api/tanks/bulk', (req: Request, res: Response) => {
  const { tanks: incoming, actor = 'لطفي محمد بلغربي' } = req.body as {
    tanks?: Array<Record<string, unknown>>;
    actor?: string;
  };
  if (!Array.isArray(incoming) || incoming.length === 0) {
    res.status(400).json({ error: 'قائمة الخزانات فارغة' });
    return;
  }

  const today = formatOffsetDate(0);
  const stmt = db.prepare(`
    INSERT INTO water_tanks (tank_code, tank_name, facility, capacity_m3, current_m3, min_safe_m3, last_inspection, notes, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let insertedCount = 0;
  const tx = db.transaction(() => {
    for (const row of incoming) {
      const code = String(row.tank_code || '').trim();
      const name = String(row.tank_name || '').trim();
      if (!code || !name) continue;
      const cap = Math.max(1, Number(row.capacity_m3) || 100);
      const cur = Math.min(cap, Math.max(0, Number(row.current_m3) || 0));
      const minSafe = Math.min(cap, Math.max(0, Number(row.min_safe_m3) || 30));
      stmt.run(
        code,
        name,
        String(row.facility || 'مركب عين مليلة').trim(),
        cap,
        cur,
        minSafe,
        String(row.last_inspection || today),
        String(row.notes || '').trim(),
        actor
      );
      insertedCount++;
    }
    if (insertedCount > 0) {
      logActivity(null, 'إضافة', 'tanks', 'جميع الهياكل', `استيراد خزانات مياه من Excel (${insertedCount})`, actor);
    }
  });
  tx();
  if (insertedCount > 0) {
    recordStorageSnapshot('استيراد Excel (خزانات)', 'tanks', req, `استيراد ${insertedCount} خزان مياه`, actor);
  }
  res.status(201).json({ inserted: insertedCount, success: true });
});

app.get('/api/facilities', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM facilities_config ORDER BY id ASC').all();
  res.json(rows);
});

app.put('/api/facilities/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM facilities_config WHERE id = ?').get(id) as
    | { id: number; name: string; search_query: string; lat: number | null; lng: number | null; address: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'الهيكل غير موجود' });
    return;
  }

  const { lat, lng, address, search_query } = req.body as {
    lat?: number | null;
    lng?: number | null;
    address?: string;
    search_query?: string;
  };

  const cleanLat = lat === null || lat === undefined || Number.isNaN(Number(lat)) ? null : Number(lat);
  const cleanLng = lng === null || lng === undefined || Number.isNaN(Number(lng)) ? null : Number(lng);

  db.prepare(`
    UPDATE facilities_config
    SET lat = ?, lng = ?, address = ?, search_query = ?, geocoded_at = ''
    WHERE id = ?
  `).run(
    cleanLat,
    cleanLng,
    address !== undefined ? String(address).trim() : existing.address,
    search_query !== undefined ? String(search_query).trim() : existing.search_query,
    id
  );

  const updated = db.prepare('SELECT * FROM facilities_config WHERE id = ?').get(id);
  recordStorageSnapshot('تحديث إحداثيات GPS', 'facilities', req, `${existing.name} (${cleanLat ?? '-'}, ${cleanLng ?? '-'})`, 'المستخدم');
  res.json({ facility: updated, success: true });
});

app.post('/api/facilities/geocode', async (req: Request, res: Response) => {
  const apiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';

  if (!apiKey) {
    res.status(400).json({ error: 'NO_MAPS_API_KEY' });
    return;
  }

  const force = req.query.force === '1';
  const rows = db.prepare('SELECT * FROM facilities_config ORDER BY id ASC').all() as Array<{
    id: number;
    name: string;
    search_query: string;
    lat: number | null;
    lng: number | null;
    address: string;
    geocoded_at: string;
  }>;

  const updateStmt = db.prepare(`
    UPDATE facilities_config
    SET lat = ?, lng = ?, address = ?, geocoded_at = datetime('now')
    WHERE id = ?
  `);

  let updatedCount = 0;
  let quotaExceeded = false;

  for (const row of rows) {
    if (!force && row.lat !== null && row.lng !== null) continue;

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        row.search_query
      )}&key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url);
      if (response.status === 429) {
        quotaExceeded = true;
        break;
      }
      const data = (await response.json()) as {
        status?: string;
        results?: Array<{
          formatted_address?: string;
          geometry?: { location?: { lat: number; lng: number } };
        }>;
      };

      if (data.status === 'OVER_QUERY_LIMIT' || data.status === 'RESOURCE_EXHAUSTED') {
        quotaExceeded = true;
        break;
      }

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const best = data.results[0];
        const loc = best.geometry?.location;
        if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
          updateStmt.run(loc.lat, loc.lng, best.formatted_address || row.address, row.id);
          updatedCount++;
        }
      }
    } catch {
      // Skip transient single lookup error
    }
  }

  const updatedRows = db.prepare('SELECT * FROM facilities_config ORDER BY id ASC').all();
  if (quotaExceeded) {
    res.status(429).json({ error: 'QUOTA_EXCEEDED', quotaExceeded: true, facilities: updatedRows, updatedCount });
    return;
  }

  res.json({ facilities: updatedRows, updatedCount, success: true });
});

app.get('/api/logs', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 60').all();
  res.json(rows);
});

// --- Anti-Incendie Electric Motors ---
const VALID_MOTOR_STATUSES = new Set(['تعمل', 'عطب', 'صيانة']);

app.get('/api/motors', (req: Request, res: Response) => {
  const { facility, status } = req.query as { facility?: string; status?: string };
  let sql = 'SELECT * FROM fire_motors WHERE 1=1';
  const params: string[] = [];
  if (facility && facility !== 'all') {
    sql += ' AND facility = ?';
    params.push(facility);
  }
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/motors', (req: Request, res: Response) => {
  const {
    motor_code,
    motor_name,
    facility,
    power_kw = 0,
    pressure_bar = 0,
    status = 'تعمل',
    last_test_date = formatOffsetDate(0),
    notes = '',
    actor = 'لطفي محمد بلغربي',
  } = req.body as Record<string, unknown>;

  if (!motor_code || !motor_name || !facility) {
    res.status(400).json({ error: 'رمز المحرك والاسم والهيكل حقول مطلوبة' });
    return;
  }
  const cleanStatus = VALID_MOTOR_STATUSES.has(String(status)) ? String(status) : 'تعمل';

  const info = db.prepare(`
    INSERT INTO fire_motors (motor_code, motor_name, facility, power_kw, pressure_bar, status, last_test_date, notes, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(motor_code).trim(),
    String(motor_name).trim(),
    String(facility).trim(),
    Math.max(0, Number(power_kw) || 0),
    Math.max(0, Number(pressure_bar) || 0),
    cleanStatus,
    String(last_test_date || formatOffsetDate(0)),
    String(notes || '').trim(),
    String(actor)
  );

  const created = db.prepare('SELECT * FROM fire_motors WHERE id = ?').get(info.lastInsertRowid);
  logActivity(Number(info.lastInsertRowid), 'إضافة', 'motors', String(facility), `${String(motor_code)} (${cleanStatus})`, String(actor));
  recordStorageSnapshot('إضافة محرك إطفاء', 'motors', req, `${String(motor_code)} · ${cleanStatus}`, String(actor));
  res.status(201).json({ motor: created, success: true });
});

app.put('/api/motors/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM fire_motors WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'المحرك غير موجود' });
    return;
  }

  const {
    motor_code = existing.motor_code,
    motor_name = existing.motor_name,
    facility = existing.facility,
    power_kw = existing.power_kw,
    pressure_bar = existing.pressure_bar,
    status = existing.status,
    last_test_date = existing.last_test_date,
    notes = existing.notes,
    actor = 'لطفي محمد بلغربي',
  } = req.body as Record<string, unknown>;

  const cleanStatus = VALID_MOTOR_STATUSES.has(String(status)) ? String(status) : String(existing.status);

  db.prepare(`
    UPDATE fire_motors
    SET motor_code = ?, motor_name = ?, facility = ?, power_kw = ?, pressure_bar = ?, status = ?, last_test_date = ?, notes = ?, updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    String(motor_code).trim(),
    String(motor_name).trim(),
    String(facility).trim(),
    Math.max(0, Number(power_kw) || 0),
    Math.max(0, Number(pressure_bar) || 0),
    cleanStatus,
    String(last_test_date || ''),
    String(notes || '').trim(),
    String(actor),
    id
  );

  const updated = db.prepare('SELECT * FROM fire_motors WHERE id = ?').get(id);
  logActivity(id, 'تحديث', 'motors', String(facility), `${String(motor_code)} (${cleanStatus})`, String(actor));
  recordStorageSnapshot('تحديث محرك إطفاء', 'motors', req, `${String(motor_code)} · ${cleanStatus}`, String(actor));
  res.json({ motor: updated, success: true });
});

app.delete('/api/motors/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM fire_motors WHERE id = ?').get(id) as { motor_code: string; facility: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'المحرك غير موجود' });
    return;
  }
  const actor = String(req.query.actor || 'لطفي محمد بلغربي');
  db.prepare('DELETE FROM fire_motors WHERE id = ?').run(id);
  logActivity(id, 'حذف', 'motors', existing.facility, existing.motor_code, actor);
  recordStorageSnapshot('حذف محرك إطفاء', 'motors', req, `حذف: ${existing.motor_code}`, actor);
  res.json({ success: true });
});

// --- Water Tanks (m3) ---
app.get('/api/tanks', (req: Request, res: Response) => {
  const { facility } = req.query as { facility?: string };
  let sql = 'SELECT * FROM water_tanks WHERE 1=1';
  const params: string[] = [];
  if (facility && facility !== 'all') {
    sql += ' AND facility = ?';
    params.push(facility);
  }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/tanks', (req: Request, res: Response) => {
  const {
    tank_code,
    tank_name,
    facility,
    capacity_m3 = 100,
    current_m3 = 0,
    min_safe_m3 = 30,
    last_inspection = formatOffsetDate(0),
    notes = '',
    actor = 'لطفي محمد بلغربي',
  } = req.body as Record<string, unknown>;

  if (!tank_code || !tank_name || !facility) {
    res.status(400).json({ error: 'رمز الخزان والاسم والهيكل حقول مطلوبة' });
    return;
  }

  const cap = Math.max(1, Number(capacity_m3) || 100);
  const cur = Math.min(cap, Math.max(0, Number(current_m3) || 0));
  const minSafe = Math.min(cap, Math.max(0, Number(min_safe_m3) || 0));

  const info = db.prepare(`
    INSERT INTO water_tanks (tank_code, tank_name, facility, capacity_m3, current_m3, min_safe_m3, last_inspection, notes, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(tank_code).trim(),
    String(tank_name).trim(),
    String(facility).trim(),
    cap,
    cur,
    minSafe,
    String(last_inspection || formatOffsetDate(0)),
    String(notes || '').trim(),
    String(actor)
  );

  const created = db.prepare('SELECT * FROM water_tanks WHERE id = ?').get(info.lastInsertRowid);
  logActivity(Number(info.lastInsertRowid), 'إضافة', 'tanks', String(facility), `${String(tank_code)} (${cur}/${cap} m³)`, String(actor));
  recordStorageSnapshot('إضافة خزان مياه', 'tanks', req, `${String(tank_code)} · ${cur}/${cap} m³`, String(actor));
  res.status(201).json({ tank: created, success: true });
});

app.put('/api/tanks/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM water_tanks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'الخزان غير موجود' });
    return;
  }

  const {
    tank_code = existing.tank_code,
    tank_name = existing.tank_name,
    facility = existing.facility,
    capacity_m3 = existing.capacity_m3,
    current_m3 = existing.current_m3,
    min_safe_m3 = existing.min_safe_m3,
    last_inspection = existing.last_inspection,
    notes = existing.notes,
    actor = 'لطفي محمد بلغربي',
  } = req.body as Record<string, unknown>;

  const cap = Math.max(1, Number(capacity_m3) || Number(existing.capacity_m3) || 100);
  const cur = Math.min(cap, Math.max(0, Number(current_m3 ?? existing.current_m3)));
  const minSafe = Math.min(cap, Math.max(0, Number(min_safe_m3 ?? existing.min_safe_m3)));

  db.prepare(`
    UPDATE water_tanks
    SET tank_code = ?, tank_name = ?, facility = ?, capacity_m3 = ?, current_m3 = ?, min_safe_m3 = ?, last_inspection = ?, notes = ?, updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    String(tank_code).trim(),
    String(tank_name).trim(),
    String(facility).trim(),
    cap,
    cur,
    minSafe,
    String(last_inspection || ''),
    String(notes || '').trim(),
    String(actor),
    id
  );

  const updated = db.prepare('SELECT * FROM water_tanks WHERE id = ?').get(id);
  logActivity(id, 'تحديث', 'tanks', String(facility), `${String(tank_code)} (${cur}/${cap} m³)`, String(actor));
  recordStorageSnapshot('تحديث خزان مياه', 'tanks', req, `${String(tank_code)} · ${cur}/${cap} m³`, String(actor));
  res.json({ tank: updated, success: true });
});

app.delete('/api/tanks/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM water_tanks WHERE id = ?').get(id) as { tank_code: string; facility: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'الخزان غير موجود' });
    return;
  }
  const actor = String(req.query.actor || 'لطفي محمد بلغربي');
  db.prepare('DELETE FROM water_tanks WHERE id = ?').run(id);
  logActivity(id, 'حذف', 'tanks', existing.facility, existing.tank_code, actor);
  recordStorageSnapshot('حذف خزان مياه', 'tanks', req, `حذف: ${existing.tank_code}`, actor);
  res.json({ success: true });
});

// --- Security & Intruder Alerts ---
app.get('/api/security/config', (_req: Request, res: Response) => {
  const row = db
    .prepare('SELECT id, supervisor_name, supervisor_phone, sms_alert_enabled, sms_webhook_url, updated_at FROM security_config WHERE id = 1')
    .get() as
    | {
        id: number;
        supervisor_name: string;
        supervisor_phone: string;
        sms_alert_enabled: number;
        sms_webhook_url: string;
        updated_at: string;
      }
    | undefined;

  res.json({
    id: row?.id ?? 1,
    supervisor_name: row?.supervisor_name ?? 'لطفي محمد بلغربي',
    supervisor_phone: row?.supervisor_phone ?? '',
    sms_alert_enabled: row?.sms_alert_enabled ?? 1,
    has_webhook: Boolean(row?.sms_webhook_url || process.env.SMS_WEBHOOK_URL),
    updated_at: row?.updated_at ?? new Date().toISOString(),
  });
});

app.put('/api/security/config', (req: Request, res: Response) => {
  const {
    supervisor_name = 'لطفي محمد بلغربي',
    supervisor_phone = '',
    sms_alert_enabled = 1,
    sms_webhook_url,
    actor = 'لطفي محمد بلغربي',
  } = req.body as {
    supervisor_name?: string;
    supervisor_phone?: string;
    sms_alert_enabled?: number | boolean;
    sms_webhook_url?: string;
    actor?: string;
  };

  const existing = db
    .prepare('SELECT sms_webhook_url FROM security_config WHERE id = 1')
    .get() as { sms_webhook_url: string } | undefined;

  const cleanPhone = String(supervisor_phone || '').trim();
  const cleanName = String(supervisor_name || 'لطفي محمد بلغربي').trim() || 'لطفي محمد بلغربي';
  const enabledFlag = sms_alert_enabled ? 1 : 0;
  const nextWebhook =
    sms_webhook_url !== undefined ? String(sms_webhook_url).trim() : (existing?.sms_webhook_url || '');

  db.prepare(`
    UPDATE security_config
    SET supervisor_name = ?, supervisor_phone = ?, sms_alert_enabled = ?, sms_webhook_url = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(cleanName, cleanPhone, enabledFlag, nextWebhook);

  const row = db
    .prepare('SELECT id, supervisor_name, supervisor_phone, sms_alert_enabled, sms_webhook_url, updated_at FROM security_config WHERE id = 1')
    .get() as {
    id: number;
    supervisor_name: string;
    supervisor_phone: string;
    sms_alert_enabled: number;
    sms_webhook_url: string;
    updated_at: string;
  };

  recordStorageSnapshot(
    'تحديث إعدادات الحماية',
    'security',
    req,
    `المسؤول: ${cleanName} (${cleanPhone || 'بدون رقم'})`,
    String(actor)
  );

  res.json({
    config: {
      id: row.id,
      supervisor_name: row.supervisor_name,
      supervisor_phone: row.supervisor_phone,
      sms_alert_enabled: row.sms_alert_enabled,
      has_webhook: Boolean(row.sms_webhook_url || process.env.SMS_WEBHOOK_URL),
      updated_at: row.updated_at,
    },
    success: true,
  });
});

app.get('/api/intruder-alerts', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM intruder_alerts ORDER BY id DESC LIMIT 100').all();
  res.json(rows);
});

app.delete('/api/intruder-alerts/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM intruder_alerts WHERE id = ?').run(id);
  res.json({ success: true });
});

// --- Storage Memory Snapshots & Full Backup Export ---
app.get('/api/storage-snapshots', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM storage_snapshots ORDER BY id DESC LIMIT 100').all();
  res.json(rows);
});

app.get('/api/storage-snapshots/export', (_req: Request, res: Response) => {
  const payload = {
    exportedAt: new Date().toISOString(),
    cooperative: 'تعاونية الحبوب والبقول الجافة عين مليلة - OAIC',
    records: db.prepare('SELECT * FROM records ORDER BY id DESC').all(),
    directives: db.prepare('SELECT * FROM directive_items ORDER BY section_code ASC, item_number ASC').all(),
    fire_motors: db.prepare('SELECT * FROM fire_motors ORDER BY id DESC').all(),
    water_tanks: db.prepare('SELECT * FROM water_tanks ORDER BY id DESC').all(),
    app_alarms: db.prepare('SELECT * FROM app_alarms ORDER BY id DESC').all(),
    facilities: db.prepare('SELECT * FROM facilities_config ORDER BY id ASC').all(),
    security_config: db
      .prepare('SELECT id, supervisor_name, supervisor_phone, sms_alert_enabled, updated_at FROM security_config WHERE id = 1')
      .get(),
    intruder_alerts: db.prepare('SELECT * FROM intruder_alerts ORDER BY id DESC LIMIT 100').all(),
    storage_snapshots: db.prepare('SELECT * FROM storage_snapshots ORDER BY id DESC LIMIT 100').all(),
  };
  res.json(payload);
});

// --- Full-App Alarms & Periodic Reminders ---
app.get('/api/alarms', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM app_alarms ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/alarms', (req: Request, res: Response) => {
  const {
    title,
    message = '',
    facility = 'مركب عين مليلة',
    due_datetime,
    repeat_cycle = 'مرة واحدة',
    sound_enabled = 1,
    actor = 'لطفي محمد بلغربي',
  } = req.body as Record<string, unknown>;

  const cleanTitle = String(title || '').trim();
  if (!cleanTitle || !due_datetime) {
    res.status(400).json({ error: 'عنوان المنبه والتاريخ/الوقت حقول مطلوبة' });
    return;
  }

  const info = db.prepare(`
    INSERT INTO app_alarms (title, message, facility, due_datetime, repeat_cycle, sound_enabled, is_active, acknowledged, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
  `).run(
    cleanTitle,
    String(message || '').trim(),
    String(facility || 'مركب عين مليلة').trim(),
    String(due_datetime),
    String(repeat_cycle || 'مرة واحدة'),
    sound_enabled ? 1 : 0,
    String(actor)
  );

  const created = db.prepare('SELECT * FROM app_alarms WHERE id = ?').get(info.lastInsertRowid);
  recordStorageSnapshot('إضافة منبه إنذار', 'alarms', req, `${cleanTitle} (${String(due_datetime)})`, String(actor));
  res.status(201).json({ alarm: created, success: true });
});

app.put('/api/alarms/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM app_alarms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'المنبه غير موجود' });
    return;
  }

  const {
    title = existing.title,
    message = existing.message,
    facility = existing.facility,
    due_datetime = existing.due_datetime,
    repeat_cycle = existing.repeat_cycle,
    sound_enabled = existing.sound_enabled,
    is_active = existing.is_active,
    acknowledged = existing.acknowledged,
    actor = 'لطفي محمد بلغربي',
  } = req.body as Record<string, unknown>;

  db.prepare(`
    UPDATE app_alarms
    SET title = ?, message = ?, facility = ?, due_datetime = ?, repeat_cycle = ?, sound_enabled = ?, is_active = ?, acknowledged = ?
    WHERE id = ?
  `).run(
    String(title).trim(),
    String(message).trim(),
    String(facility).trim(),
    String(due_datetime),
    String(repeat_cycle),
    sound_enabled ? 1 : 0,
    is_active ? 1 : 0,
    acknowledged ? 1 : 0,
    id
  );

  const updated = db.prepare('SELECT * FROM app_alarms WHERE id = ?').get(id);
  recordStorageSnapshot('تحديث منبه إنذار', 'alarms', req, `${String(title).trim()}`, String(actor));
  res.json({ alarm: updated, success: true });
});

app.delete('/api/alarms/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT title FROM app_alarms WHERE id = ?').get(id) as { title: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'المنبه غير موجود' });
    return;
  }
  const actor = String(req.query.actor || 'لطفي محمد بلغربي');
  db.prepare('DELETE FROM app_alarms WHERE id = ?').run(id);
  recordStorageSnapshot('حذف منبه إنذار', 'alarms', req, `حذف: ${existing.title}`, actor);
  res.json({ success: true });
});

interface HourlyWeatherPoint {
  time: string;
  hourLabel: string;
  temp: number;
  humidity: number;
  windspeed: number;
  conditionLabel: string;
  conditionCode: number;
}

interface WeatherPayload {
  temp: number;
  humidity: number;
  windspeed: number;
  conditionCode: number;
  conditionLabel: string;
  updatedAt: string;
  isLive: boolean;
  hourly: HourlyWeatherPoint[];
}

let weatherCache: {
  data: WeatherPayload;
  fetchedAt: number;
} | null = null;

function mapWeatherCode(code: number): string {
  if (code === 0) return 'سماء صافية';
  if (code <= 3) return 'غائم جزئياً';
  if (code <= 48) return 'ضباب خفيف';
  if (code <= 67) return 'أمطار متفرقة';
  if (code <= 77) return 'طقس بارد';
  if (code >= 80) return 'زخات مطر';
  return 'مستقر';
}

function buildFallbackWeather(): WeatherPayload {
  const now = new Date();
  const hourly: HourlyWeatherPoint[] = Array.from({ length: 8 }, (_, idx) => {
    const slot = new Date(now.getTime() + idx * 60 * 60 * 1000);
    const hh = String(slot.getHours()).padStart(2, '0');
    return {
      time: slot.toISOString(),
      hourLabel: `${hh}:00`,
      temp: 18 - Math.floor(idx / 3),
      humidity: 48 + idx * 2,
      windspeed: 12 + (idx % 3),
      conditionCode: 1,
      conditionLabel: 'معتدل',
    };
  });
  return {
    temp: 18,
    humidity: 48,
    windspeed: 12,
    conditionCode: 1,
    conditionLabel: 'معتدل · عين مليلة',
    updatedAt: now.toISOString(),
    isLive: false,
    hourly,
  };
}

app.get('/api/weather', async (req: Request, res: Response) => {
  const now = Date.now();
  const forceRefresh = req.query.refresh === '1';
  if (!forceRefresh && weatherCache && now - weatherCache.fetchedAt < 55 * 60 * 1000) {
    res.json(weatherCache.data);
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=36.0386&longitude=6.5714&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&forecast_days=2&timezone=Africa%2FAlgiers',
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error('Weather upstream failed');
    }
    const json = (await response.json()) as {
      current?: {
        time?: string;
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        weather_code?: number;
      };
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        relative_humidity_2m?: number[];
        wind_speed_10m?: number[];
        weather_code?: number[];
      };
    };

    const currentCode = Number(json.current?.weather_code ?? 0);
    const currentTimePrefix = String(json.current?.time || '').slice(0, 13);
    const times = json.hourly?.time || [];
    let startIdx = times.findIndex((t) => t.slice(0, 13) >= currentTimePrefix);
    if (startIdx < 0) startIdx = 0;

    const hourly: HourlyWeatherPoint[] = times
      .slice(startIdx, startIdx + 8)
      .map((timeStr, offset) => {
        const i = startIdx + offset;
        const hCode = Number(json.hourly?.weather_code?.[i] ?? currentCode);
        return {
          time: timeStr,
          hourLabel: timeStr.slice(11, 16) || '--:--',
          temp: Math.round(Number(json.hourly?.temperature_2m?.[i] ?? 18)),
          humidity: Math.round(Number(json.hourly?.relative_humidity_2m?.[i] ?? 50)),
          windspeed: Math.round(Number(json.hourly?.wind_speed_10m?.[i] ?? 12)),
          conditionCode: hCode,
          conditionLabel: mapWeatherCode(hCode),
        };
      });

    const payload: WeatherPayload = {
      temp: Math.round(Number(json.current?.temperature_2m ?? 19)),
      humidity: Math.round(Number(json.current?.relative_humidity_2m ?? 48)),
      windspeed: Math.round(Number(json.current?.wind_speed_10m ?? 12)),
      conditionCode: currentCode,
      conditionLabel: mapWeatherCode(currentCode),
      updatedAt: new Date().toISOString(),
      isLive: true,
      hourly,
    };
    weatherCache = { data: payload, fetchedAt: now };
    res.json(payload);
  } catch {
    res.json(buildFallbackWeather());
  }
});

async function startServer(): Promise<void> {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CCLS Ain Mlila server listening on http://localhost:${PORT}`);
  });
}

startServer();

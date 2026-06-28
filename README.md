# Rainbow The Learner Zone ERP

This version is mapped to your existing Supabase tables. It does not create old/new mixed JSON tables.

## Default Login

- Username: admin
- Password: Rainbow@123

Change these in app.js before public launch: AUTH_USER and AUTH_PASS.

## Existing Supabase Tables Used

- students
- admissions
- fees_receipts
- attendance

Your current schema is supported:

students: student_id, admission_no, student_name, father_name, mother_name, mobile, class, batch, admission_date, address, total_fees, paid_fees, pending_fees, status, school_name

admissions: student_id, admission_date, remarks

fees_receipts: receipt_no, student_id, amount, month, payment_mode, transaction_id

attendance: student_id, attendance_date, status, time_in, time_out, remarks

## Supabase Setup

1. Do not run the older create-table JSON schema.
2. Open supabase-schema.sql in this folder.
3. Run the column-check query first.
4. If tables are UNRESTRICTED, the app can work without policy changes.
5. If you enable RLS, run the included anon CRUD policy block.

## Notes

- App reads/writes directly to your existing Supabase tables.
- fees_receipts is used instead of a new fees table.
- Settings remain local in browser because your current DB has no settings table.
- LocalStorage fallback remains active if Supabase is unavailable.
- For stronger security later, use Supabase Auth instead of open anon CRUD policies.

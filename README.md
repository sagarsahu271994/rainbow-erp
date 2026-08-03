# Rainbow ERP

Production-ready School ERP using HTML, CSS, Vanilla JavaScript, Vercel, Supabase PostgreSQL, Supabase Storage, and Google Sheets backup.

## Login

- Username: admin
- Password: Rainbow@123

## Deployment

Upload this folder to GitHub or Vercel. Keep all files and the `js` folder together.

## Supabase

Run `supabase-schema.sql` once in Supabase SQL Editor. It only adds required columns, indexes, policies, and the public `documents` Storage bucket. It does not delete existing data.

PDFs are saved in Supabase Storage:

- documents/admissions
- documents/receipts
- documents/students

Admission and receipt public URLs are saved in `admissions.pdf_url` and `fees_receipts.pdf_url`.

## Google Sheets

Apps Script sync is still available through Settings > Apps Script Web App URL. Every student, admission, and fee save continues sending backup payloads when the URL is configured.
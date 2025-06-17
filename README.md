# Aquatemp API

API Node.js untuk menghubungkan IoT ke database Supabase.

## Endpoints

- POST `/api/sensor-data` - Simpan data suhu
- POST `/api/temperature-setting` - Simpan pengaturan suhu min/max
- POST `/api/heater-status` - Simpan status heater (auto/off)
- POST `/api/riwayat` - Simpan durasi heater dan pompa
- GET `/api/*` - Ambil data terakhir dengan query parameter `user_id`

## Deploy to Railway

1. Push ke GitHub repository
2. Connect ke Railway
3. Set environment variables di Railway dashboard

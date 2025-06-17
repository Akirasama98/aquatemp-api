import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import mqtt from "mqtt";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// MQTT Client - sesuai dengan konfigurasi Arduino
const mqttOptions = {
  host: process.env.MQTT_SERVER || '2919163bbc8f43aca4ac29f7167d2890.s1.eu.hivemq.cloud',
  port: parseInt(process.env.MQTT_PORT) || 8883,
  protocol: 'mqtts',
  username: process.env.MQTT_USER || 'hivemq.webclient.1750189435021',
  password: process.env.MQTT_PASS || '.cf7DdA#Rs8?2,Eh6JSb',
  rejectUnauthorized: false
};

console.log('MQTT Config:', {
  host: mqttOptions.host,
  port: mqttOptions.port,
  username: mqttOptions.username,
  password: mqttOptions.password ? '[HIDDEN]' : 'NOT SET'
});

let mqttClient;
try {
  mqttClient = mqtt.connect(mqttOptions);
} catch (error) {
  console.error('Failed to create MQTT client:', error);
  mqttClient = { connected: false, reconnecting: false }; // Mock object
}

// MQTT Topics - sesuai dengan Arduino
const TOPIC_CONTROL = "iot/device/control";
const TOPIC_STATUS = "iot/device/status";

// Koneksi MQTT
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  mqttClient.subscribe(TOPIC_STATUS, (err) => {
    if (!err) {
      console.log(`Subscribed to ${TOPIC_STATUS}`);
    } else {
      console.error('MQTT Subscribe error:', err);
    }
  });
});

// Error handling MQTT
mqttClient.on('error', (error) => {
  console.error('MQTT Connection error:', error);
});

mqttClient.on('offline', () => {
  console.log('MQTT Client offline');
});

mqttClient.on('reconnect', () => {
  console.log('MQTT Client reconnecting...');
});

// Handle pesan dari ESP32
mqttClient.on('message', async (topic, message) => {
  if (topic === TOPIC_STATUS) {
    const data = message.toString();
    console.log('Received from ESP32:', data);
    
    // Parse data dari ESP32
    // Format: "Suhu: 32.5 C, Mode: Auto, Min: 30, Max: 40, Durasi Heater: 120s, Durasi Pompa: 60s"
    const parsed = parseESP32Data(data);
    if (parsed) {
      await saveToDatabase(parsed);
    }
  }
});

// Fungsi untuk parse data dari ESP32
function parseESP32Data(data) {
  try {
    const suhuMatch = data.match(/Suhu: ([\d.]+) C/);
    const modeMatch = data.match(/Mode: (Auto|Off)/);
    const minMatch = data.match(/Min: ([\d.]+)/);
    const maxMatch = data.match(/Max: ([\d.]+)/);
    const heaterMatch = data.match(/Durasi Heater: (\d+)s/);
    const pompaMatch = data.match(/Durasi Pompa: (\d+)s/);

    if (suhuMatch) {
      return {
        suhu: parseFloat(suhuMatch[1]),
        mode: modeMatch ? modeMatch[1].toLowerCase() : null,
        min: minMatch ? parseFloat(minMatch[1]) : null,
        max: maxMatch ? parseFloat(maxMatch[1]) : null,
        durasi_heater: heaterMatch ? parseInt(heaterMatch[1]) : null,
        durasi_pompa: pompaMatch ? parseInt(pompaMatch[1]) : null
      };
    }
    return null;
  } catch (error) {
    console.error('Error parsing ESP32 data:', error);
    return null;
  }
}

// Fungsi untuk menyimpan data ke database
async function saveToDatabase(data) {
  try {
    // Simpan data sensor
    if (data.suhu !== null) {
      await supabase.from("sensor_data").insert([{
        suhu: data.suhu,
        user_id: DEFAULT_IOT_USER_ID
      }]);
    }

    // Simpan setting suhu jika ada perubahan
    if (data.min !== null && data.max !== null) {
      await supabase.from("temperature_setting").insert([{
        suhu_min: data.min,
        suhu_max: data.max,
        user_id: DEFAULT_IOT_USER_ID
      }]);
    }

    // Simpan status heater
    if (data.mode !== null) {
      await supabase.from("heater_status").insert([{
        status: data.mode,
        user_id: DEFAULT_IOT_USER_ID
      }]);
    }

    // Simpan riwayat durasi
    if (data.durasi_heater !== null && data.durasi_pompa !== null) {
      await supabase.from("riwayat").insert([{
        durasi_heater: data.durasi_heater,
        durasi_pompa: data.durasi_pompa,
        user_id: DEFAULT_IOT_USER_ID
      }]);
    }

    console.log('Data saved to database successfully');
  } catch (error) {
    console.error('Error saving to database:', error);
  }
}

// Endpoint untuk mengirim command ke ESP32
app.post("/api/send-command", (req, res) => {
  const { command } = req.body;
  mqttClient.publish(TOPIC_CONTROL, command, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Command sent to ESP32", command });
  });
});

// Default user ID untuk IoT device
const DEFAULT_IOT_USER_ID = "00000000-0000-0000-0000-000000000000";

// Helper function untuk mendapatkan user_id yang tepat
function getUserId(requestUserId) {
  return requestUserId || DEFAULT_IOT_USER_ID;
}

// POST /api/temperature-setting
app.post("/api/temperature-setting", async (req, res) => {
  const { suhu_min, suhu_max, user_id } = req.body;
  const finalUserId = getUserId(user_id);
  const { error } = await supabase
    .from("temperature_setting")
    .insert([{ suhu_min, suhu_max, user_id: finalUserId }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Temperature setting saved" });
});

// POST /api/sensor-data
app.post("/api/sensor-data", async (req, res) => {
  const { suhu, user_id } = req.body;
  const finalUserId = getUserId(user_id);
  const { error } = await supabase
    .from("sensor_data")
    .insert([{ suhu, user_id: finalUserId }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Sensor data saved" });
});

// POST /api/heater-status
app.post("/api/heater-status", async (req, res) => {
  const { status, user_id } = req.body; // status: "auto" atau "off"
  const finalUserId = getUserId(user_id);
  const { error } = await supabase
    .from("heater_status")
    .insert([{ status, user_id: finalUserId }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Heater status saved" });
});

// POST /api/riwayat
app.post("/api/riwayat", async (req, res) => {
  const { durasi_heater, durasi_pompa, user_id } = req.body;
  const finalUserId = getUserId(user_id);
  const { error } = await supabase
    .from("riwayat")
    .insert([{ durasi_heater, durasi_pompa, user_id: finalUserId }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Riwayat saved" });
});

// Contoh GET endpoint untuk mengambil data terakhir per tabel
app.get("/api/temperature-setting", async (req, res) => {
  const { user_id } = req.query;
  const finalUserId = getUserId(user_id);
  const { data, error } = await supabase
    .from("temperature_setting")
    .select("*")
    .eq("user_id", finalUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0] || {});
});

app.get("/api/sensor-data", async (req, res) => {
  const { user_id } = req.query;
  const finalUserId = getUserId(user_id);
  const { data, error } = await supabase
    .from("sensor_data")
    .select("*")
    .eq("user_id", finalUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0] || {});
});

app.get("/api/heater-status", async (req, res) => {
  const { user_id } = req.query;
  const finalUserId = getUserId(user_id);
  const { data, error } = await supabase
    .from("heater_status")
    .select("*")
    .eq("user_id", finalUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0] || {});
});

app.get("/api/riwayat", async (req, res) => {
  const { user_id } = req.query;
  const finalUserId = getUserId(user_id);
  const { data, error } = await supabase
    .from("riwayat")
    .select("*")
    .eq("user_id", finalUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0] || {});
});

// Khusus endpoint untuk IoT (tanpa user_id)
app.post("/api/iot/sensor-data", async (req, res) => {
  const { suhu } = req.body;
  
  // Insert tanpa user_id untuk IoT
  const { error } = await supabase
    .from("sensor_data")
    .insert([{ suhu }]);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "IoT sensor data saved" });
});

app.post("/api/iot/temperature-setting", async (req, res) => {
  const { suhu_min, suhu_max } = req.body;
  
  const { error } = await supabase
    .from("temperature_setting")
    .insert([{ suhu_min, suhu_max }]);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "IoT temperature setting saved" });
});

app.post("/api/iot/heater-status", async (req, res) => {
  const { status } = req.body;
  
  const { error } = await supabase
    .from("heater_status")
    .insert([{ status }]);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "IoT heater status saved" });
});

app.post("/api/iot/riwayat", async (req, res) => {
  const { durasi_heater, durasi_pompa } = req.body;
  
  const { error } = await supabase
    .from("riwayat")
    .insert([{ durasi_heater, durasi_pompa }]);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "IoT riwayat saved" });
});

// Health check endpoint untuk MQTT status
app.get("/api/health", (req, res) => {
  const status = {
    api: "running",
    mqtt_connected: mqttClient ? mqttClient.connected : false,
    mqtt_reconnecting: mqttClient ? mqttClient.reconnecting : false,
    env_vars: {
      mqtt_server: process.env.MQTT_SERVER ? 'SET' : 'NOT SET',
      mqtt_port: process.env.MQTT_PORT ? 'SET' : 'NOT SET',
      mqtt_user: process.env.MQTT_USER ? 'SET' : 'NOT SET',
      mqtt_pass: process.env.MQTT_PASS ? 'SET' : 'NOT SET'
    },
    timestamp: new Date().toISOString()
  };
  res.json(status);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});

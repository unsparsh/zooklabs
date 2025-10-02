/**
 * Supabase-Integrated Hotel Management Server
 *
 * This server uses Supabase as the primary database for all operations.
 * It handles authentication, room management, and guest check-in/check-out with proper billing tracking.
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Supabase configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials missing!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'humari-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Hotel Management API with Supabase', status: 'running' });
});

// AUTH ROUTES
app.post('/api/auth/register', async (req, res) => {
  try {
    const { hotelName, email, password, phone, address, totalRooms, adminName } = req.body;

    // Check if hotel exists
    const { data: existingHotel } = await supabase
      .from('hotels')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingHotel) {
      return res.status(400).json({ message: 'Hotel already registered with this email' });
    }

    // Create hotel
    const { data: hotel, error: hotelError } = await supabase
      .from('hotels')
      .insert([{
        name: hotelName,
        email,
        phone,
        address,
        total_rooms: totalRooms
      }])
      .select()
      .single();

    if (hotelError) throw hotelError;

    // Create admin user
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        email,
        password: hashedPassword,
        name: adminName,
        role: 'admin',
        hotel_id: hotel.id
      }])
      .select()
      .single();

    if (userError) throw userError;

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, hotelId: hotel.id },
      process.env.JWT_SECRET || 'humari-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        _id: user.id,
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      hotel: {
        _id: hotel.id,
        id: hotel.id,
        name: hotel.name,
        email: hotel.email,
        phone: hotel.phone,
        address: hotel.address,
        totalRooms: hotel.total_rooms,
        settings: hotel.settings
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Get hotel
    const { data: hotel, error: hotelError } = await supabase
      .from('hotels')
      .select('*')
      .eq('id', user.hotel_id)
      .single();

    if (hotelError || !hotel) {
      return res.status(400).json({ message: 'Hotel not found' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, hotelId: hotel.id },
      process.env.JWT_SECRET || 'humari-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        _id: user.id,
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      hotel: {
        _id: hotel.id,
        id: hotel.id,
        name: hotel.name,
        email: hotel.email,
        phone: hotel.phone,
        address: hotel.address,
        totalRooms: hotel.total_rooms,
        settings: hotel.settings
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

// HOTEL ROUTES
app.get('/api/hotels/:id', authenticateToken, async (req, res) => {
  try {
    const { data: hotel, error } = await supabase
      .from('hotels')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    res.json(hotel);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.put('/api/hotels/:id', authenticateToken, async (req, res) => {
  try {
    const { data: hotel, error } = await supabase
      .from('hotels')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    res.json(hotel);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ROOM ROUTES
app.get('/api/hotels/:hotelId/rooms', authenticateToken, async (req, res) => {
  try {
    const { data: rooms, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('hotel_id', req.params.hotelId)
      .order('number', { ascending: true });

    if (error) throw error;
    res.json(rooms || []);
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ message: 'Failed to fetch rooms', error: error.message });
  }
});

app.post('/api/hotels/:hotelId/rooms', authenticateToken, async (req, res) => {
  try {
    const { hotelId } = req.params;
    const roomData = req.body;

    // Check for duplicate
    const { data: existingRoom } = await supabase
      .from('rooms')
      .select('id')
      .eq('hotel_id', hotelId)
      .eq('number', roomData.number)
      .maybeSingle();

    if (existingRoom) {
      return res.status(400).json({ message: 'Room number already exists' });
    }

    // Generate UUID and QR code
    const roomUuid = uuidv4();
    const qrData = `${process.env.CLIENT_URL || 'http://localhost:5173'}/guest/${hotelId}/${roomUuid}`;
    const qrCode = await qrcode.toDataURL(qrData);

    // Create room
    const { data: room, error } = await supabase
      .from('rooms')
      .insert([{
        hotel_id: hotelId,
        number: roomData.number,
        name: roomData.name || `Room ${roomData.number}`,
        type: roomData.type || 'Standard',
        status: roomData.status || 'available',
        rate: roomData.rate || 2500,
        max_occupancy: roomData.maxOccupancy || 2,
        amenities: roomData.amenities || [],
        uuid: roomUuid,
        qr_code: qrCode,
        is_active: true
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(room);
  } catch (error) {
    console.error('Room creation error:', error);
    res.status(500).json({ message: 'Failed to create room', error: error.message });
  }
});

app.put('/api/hotels/:hotelId/rooms/:roomId', authenticateToken, async (req, res) => {
  try {
    const { hotelId, roomId } = req.params;

    const { data: room, error } = await supabase
      .from('rooms')
      .update(req.body)
      .eq('id', roomId)
      .eq('hotel_id', hotelId)
      .select()
      .single();

    if (error) throw error;
    if (!room) return res.status(404).json({ message: 'Room not found' });

    res.json(room);
  } catch (error) {
    console.error('Room update error:', error);
    res.status(500).json({ message: 'Failed to update room', error: error.message });
  }
});

app.delete('/api/hotels/:hotelId/rooms/:roomId', authenticateToken, async (req, res) => {
  try {
    const { hotelId, roomId } = req.params;

    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId)
      .eq('hotel_id', hotelId);

    if (error) throw error;
    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Room deletion error:', error);
    res.status(500).json({ message: 'Failed to delete room', error: error.message });
  }
});

// GUEST ROUTES (Check-in/Check-out)
app.get('/api/hotels/:hotelId/guests', authenticateToken, async (req, res) => {
  try {
    const { data: guests, error } = await supabase
      .from('guests')
      .select('*')
      .eq('hotel_id', req.params.hotelId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(guests || []);
  } catch (error) {
    console.error('Get guests error:', error);
    res.status(500).json({ message: 'Failed to fetch guests', error: error.message });
  }
});

app.post('/api/hotels/:hotelId/guests', authenticateToken, async (req, res) => {
  try {
    const { hotelId } = req.params;
    const guestData = req.body;

    // Create guest
    const { data: guest, error: guestError } = await supabase
      .from('guests')
      .insert([{
        hotel_id: hotelId,
        room_id: guestData.roomId,
        name: guestData.name,
        email: guestData.email,
        phone: guestData.phone,
        id_type: guestData.idType,
        id_number: guestData.idNumber,
        address: guestData.address,
        check_in_date: guestData.checkInDate,
        check_out_date: guestData.checkOutDate,
        adults: guestData.adults,
        children: guestData.children,
        room_number: guestData.roomNumber,
        room_type: guestData.roomType,
        rate_per_night: guestData.ratePerNight,
        total_nights: guestData.totalNights,
        total_amount: guestData.totalAmount,
        advance_payment: guestData.advancePayment,
        paid_amount: guestData.paidAmount,
        pending_amount: guestData.pendingAmount,
        special_requests: guestData.specialRequests,
        status: 'checked-in'
      }])
      .select()
      .single();

    if (guestError) throw guestError;

    console.log('✅ Guest checked in:', guest.name, 'Room:', guest.room_number);
    res.status(201).json(guest);
  } catch (error) {
    console.error('Guest check-in error:', error);
    res.status(500).json({ message: 'Failed to check in guest', error: error.message });
  }
});

app.put('/api/hotels/:hotelId/guests/:guestId', authenticateToken, async (req, res) => {
  try {
    const { hotelId, guestId } = req.params;
    const updates = req.body;

    // If checking out, set actual check-out date
    if (updates.status === 'checked-out') {
      updates.actual_check_out_date = new Date().toISOString();
    }

    const { data: guest, error } = await supabase
      .from('guests')
      .update(updates)
      .eq('id', guestId)
      .eq('hotel_id', hotelId)
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Guest updated:', guest.name, 'Status:', guest.status);
    res.json(guest);
  } catch (error) {
    console.error('Guest update error:', error);
    res.status(500).json({ message: 'Failed to update guest', error: error.message });
  }
});

app.delete('/api/hotels/:hotelId/guests/:guestId', authenticateToken, async (req, res) => {
  try {
    const { hotelId, guestId } = req.params;

    const { error } = await supabase
      .from('guests')
      .delete()
      .eq('id', guestId)
      .eq('hotel_id', hotelId);

    if (error) throw error;

    console.log('✅ Guest deleted from database');
    res.json({ message: 'Guest deleted successfully' });
  } catch (error) {
    console.error('Guest deletion error:', error);
    res.status(500).json({ message: 'Failed to delete guest', error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Using Supabase for data persistence`);
  console.log(`🔗 Client URL: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
});

const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
      {
        urls: 'turn:global.turn.twilio.com:3478?transport=udp',
        username: 'YOUR_TWILIO_USERNAME',
        credential: 'YOUR_TWILIO_CREDENTIAL'
      }
      // ...add more as needed
    ]
  });
});

module.exports = router;

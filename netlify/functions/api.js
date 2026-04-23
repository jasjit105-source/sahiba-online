const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

// ═══ INIT DATABASE TABLES ═══
async function initDB() {
  await sql`CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    contact_id TEXT UNIQUE NOT NULL,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    lifecycle TEXT DEFAULT '',
    assignee TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    status TEXT DEFAULT '',
    last_interaction TEXT DEFAULT '',
    date_created TEXT DEFAULT '',
    channels TEXT DEFAULT '',
    is_new BOOLEAN DEFAULT true,
    batch_id TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  
  await sql`CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    date_time TEXT DEFAULT '',
    sender_id TEXT DEFAULT '',
    sender_type TEXT DEFAULT '',
    contact_id TEXT NOT NULL,
    message_id TEXT DEFAULT '',
    content_type TEXT DEFAULT '',
    message_type TEXT DEFAULT '',
    content TEXT DEFAULT '',
    channel_id TEXT DEFAULT '',
    msg_type TEXT DEFAULT '',
    sub_type TEXT DEFAULT '',
    batch_id TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  
  await sql`CREATE TABLE IF NOT EXISTS agent_log (
    id SERIAL PRIMARY KEY,
    timestamp TEXT DEFAULT '',
    agent TEXT DEFAULT '',
    lead_name TEXT DEFAULT '',
    lead_phone TEXT DEFAULT '',
    contact_id TEXT DEFAULT '',
    action TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    lead_score TEXT DEFAULT '',
    priority TEXT DEFAULT '',
    city TEXT DEFAULT '',
    lifecycle TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  
  await sql`CREATE TABLE IF NOT EXISTS upload_batches (
    id SERIAL PRIMARY KEY,
    batch_id TEXT UNIQUE NOT NULL,
    uploaded_by TEXT DEFAULT 'admin',
    contact_count INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    new_contact_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  
  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_contacts_contact_id ON contacts(contact_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_contact_id ON messages(contact_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_contacts_batch ON contacts(batch_id)`;
}

// ═══ CSV PARSER ═══
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (inQ && text[i+1] === '"') { field += '"'; i++; } else { inQ = !inQ; } }
    else if (c === ',' && !inQ) { row.push(field); field = ''; }
    else if ((c === '\n' || (c === '\r' && text[i+1] === '\n')) && !inQ) {
      if (c === '\r') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else { field += c; }
  }
  if (field || row.length) row.push(field);
  if (row.length) rows.push(row);
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
    return obj;
  });
}

// ═══ FIND COLUMN ═══
function findCol(obj, names) {
  for (const n of names) { if (obj[n] !== undefined) return obj[n]; }
  return '';
}

// ═══ HANDLER ═══
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    // Initialize tables on first call
    await initDB();
    
    const path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
    
    // ═══ GET /data — Load all CRM data ═══
    if (event.httpMethod === 'GET' && (path === '/data' || path === '' || path === '/')) {
      const contacts = await sql`SELECT * FROM contacts ORDER BY updated_at DESC`;
      const messages = await sql`SELECT * FROM messages ORDER BY date_time DESC`;
      const lastBatch = await sql`SELECT * FROM upload_batches ORDER BY created_at DESC LIMIT 1`;
      
      // Convert to CSV format the dashboard expects
      const cHeaders = ['ContactID','FirstName','LastName','PhoneNumber','Email','Country','Language','Tags','Status','Lifecycle','Assignee','LastInteractionTime','DateTimeCreated','Channels','ciudad','is_new'];
      let cCSV = cHeaders.join(',') + '\n';
      for (const c of contacts) {
        cCSV += [c.contact_id, c.first_name, c.last_name, c.phone, c.email, '', '', c.tags, c.status, c.lifecycle, c.assignee, c.last_interaction, c.date_created, c.channels, c.city, c.is_new ? '1' : '0']
          .map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',') + '\n';
      }
      
      const mHeaders = ['Date & Time','Sender ID','Sender Type','Contact ID','Message ID','Content Type','Message Type','Content','Channel ID','Type','Sub Type'];
      let mCSV = mHeaders.join(',') + '\n';
      for (const m of messages) {
        mCSV += [m.date_time, m.sender_id, m.sender_type, m.contact_id, m.message_id, m.content_type, m.message_type, m.content, m.channel_id, m.msg_type, m.sub_type]
          .map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',') + '\n';
      }
      
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: 'ok',
          contactCount: contacts.length,
          messageCount: messages.length,
          newContactCount: contacts.filter(c => c.is_new).length,
          lastUpload: lastBatch.length ? lastBatch[0].created_at : null,
          batchId: lastBatch.length ? lastBatch[0].batch_id : null,
          contactsCSV: cCSV,
          messagesCSV: mCSV
        })
      };
    }
    
    // ═══ POST /upload — Upload new CSV data ═══
    if (event.httpMethod === 'POST' && path === '/upload') {
      const body = JSON.parse(event.body);
      const { contactsCSV, messagesCSV } = body;
      const batchId = 'batch_' + Date.now();
      
      let newCount = 0, updatedCount = 0, totalContacts = 0, totalMessages = 0;
      
      // Process contacts
      if (contactsCSV) {
        const contacts = csvToObjects(contactsCSV);
        totalContacts = contacts.length;
        
        // Get existing contact IDs
        const existing = await sql`SELECT contact_id FROM contacts`;
        const existingSet = new Set(existing.map(e => e.contact_id));
        
        // Mark all current contacts as not-new
        await sql`UPDATE contacts SET is_new = false`;
        
        // Upsert contacts
        for (const c of contacts) {
          const cid = findCol(c, ['ContactID', 'Contact ID', 'contact_id', 'id']);
          if (!cid) continue;
          
          const isNew = !existingSet.has(cid);
          if (isNew) newCount++;
          else updatedCount++;
          
          const firstName = findCol(c, ['FirstName', 'First Name', 'first_name']);
          const lastName = findCol(c, ['LastName', 'Last Name', 'last_name']);
          const phone = findCol(c, ['PhoneNumber', 'Phone', 'phone', 'Phone Number']);
          const email = findCol(c, ['Email', 'email']);
          const lifecycle = findCol(c, ['Lifecycle', 'lifecycle']);
          const assignee = findCol(c, ['Assignee', 'assignee']);
          const city = findCol(c, ['ciudad', 'City', 'city']);
          const tags = findCol(c, ['Tags', 'tags']);
          const status = findCol(c, ['Status', 'status']);
          const lastInt = findCol(c, ['LastInteractionTime', 'Last Interaction Time']);
          const dateCreated = findCol(c, ['DateTimeCreated', 'Date Time Created']);
          const channels = findCol(c, ['Channels', 'channels']);
          
          await sql`INSERT INTO contacts (contact_id, first_name, last_name, phone, email, lifecycle, assignee, city, tags, status, last_interaction, date_created, channels, is_new, batch_id, updated_at)
            VALUES (${cid}, ${firstName}, ${lastName}, ${phone}, ${email}, ${lifecycle}, ${assignee}, ${city}, ${tags}, ${status}, ${lastInt}, ${dateCreated}, ${channels}, ${isNew}, ${batchId}, NOW())
            ON CONFLICT (contact_id) DO UPDATE SET
              first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = EXCLUDED.phone,
              email = EXCLUDED.email, lifecycle = EXCLUDED.lifecycle, assignee = EXCLUDED.assignee,
              city = EXCLUDED.city, tags = EXCLUDED.tags, status = EXCLUDED.status,
              last_interaction = EXCLUDED.last_interaction, date_created = EXCLUDED.date_created,
              channels = EXCLUDED.channels, is_new = ${isNew}, batch_id = ${batchId}, updated_at = NOW()`;
        }
      }
      
      // Process messages — replace all (fresh snapshot each upload)
      if (messagesCSV) {
        const messages = csvToObjects(messagesCSV);
        totalMessages = messages.length;
        
        // Clear old messages and insert new
        await sql`TRUNCATE TABLE messages`;
        
        // Insert in batches of 100
        for (let i = 0; i < messages.length; i += 100) {
          const batch = messages.slice(i, i + 100);
          for (const m of batch) {
            const cid = findCol(m, ['Contact ID', 'ContactID', 'contact_id']);
            if (!cid) continue;
            await sql`INSERT INTO messages (date_time, sender_id, sender_type, contact_id, message_id, content_type, message_type, content, channel_id, msg_type, sub_type, batch_id)
              VALUES (${findCol(m,['Date & Time','DateTime'])}, ${findCol(m,['Sender ID','SenderID'])}, ${findCol(m,['Sender Type','SenderType'])}, ${cid}, ${findCol(m,['Message ID','MessageID'])}, ${findCol(m,['Content Type','ContentType'])}, ${findCol(m,['Message Type','MessageType'])}, ${findCol(m,['Content','content'])}, ${findCol(m,['Channel ID','ChannelID'])}, ${findCol(m,['Type','type'])}, ${findCol(m,['Sub Type','SubType'])}, ${batchId})`;
          }
        }
      }
      
      // Save batch record
      await sql`INSERT INTO upload_batches (batch_id, contact_count, message_count, new_contact_count) VALUES (${batchId}, ${totalContacts}, ${totalMessages}, ${newCount})`;
      
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: 'ok', batchId,
          contacts: totalContacts,
          messages: totalMessages,
          newContacts: newCount,
          updatedContacts: updatedCount
        })
      };
    }
    
    // ═══ POST /checkin — Agent check-in ═══
    if (event.httpMethod === 'POST' && path === '/checkin') {
      const data = JSON.parse(event.body);
      await sql`INSERT INTO agent_log (timestamp, agent, lead_name, lead_phone, contact_id, action, notes, lead_score, priority, city, lifecycle)
        VALUES (${new Date().toLocaleString('es-MX', {timeZone: 'America/Mexico_City'})}, ${data.agent||''}, ${data.name||''}, ${data.phone||''}, ${data.contactId||''}, ${data.action||''}, ${data.notes||''}, ${data.score||''}, ${data.priority||''}, ${data.city||''}, ${data.lifecycle||''})`;
      return { statusCode: 200, headers, body: JSON.stringify({status: 'ok'}) };
    }
    
    // ═══ GET /logs — Get agent logs ═══
    if (event.httpMethod === 'GET' && path === '/logs') {
      const logs = await sql`SELECT * FROM agent_log ORDER BY created_at DESC LIMIT 500`;
      return { statusCode: 200, headers, body: JSON.stringify({status: 'ok', data: logs}) };
    }
    
    // ═══ GET /status — Check DB status ═══
    if (event.httpMethod === 'GET' && path === '/status') {
      const cCount = await sql`SELECT COUNT(*) as count FROM contacts`;
      const mCount = await sql`SELECT COUNT(*) as count FROM messages`;
      const lastBatch = await sql`SELECT * FROM upload_batches ORDER BY created_at DESC LIMIT 1`;
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: 'ok',
          contacts: cCount[0].count,
          messages: mCount[0].count,
          lastUpload: lastBatch.length ? lastBatch[0] : null
        })
      };
    }
    
    return { statusCode: 404, headers, body: JSON.stringify({error: 'Not found'}) };
    
  } catch (err) {
    console.error('API Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({error: err.message}) };
  }
};

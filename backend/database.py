import sqlite3
import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from contextlib import contextmanager

logger = logging.getLogger(__name__)


class ProfileDB:
    """Lightweight SQLite database for user profiles and progress tracking."""
    
    def __init__(self, db_path="profiles.db"):
        self.db_path = db_path
        self.init_db()
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # Return rows as dictionaries
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def init_db(self):
        """Initialize database tables."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # User profiles table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_profiles (
                    session_id TEXT PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    -- Demographics
                    age INTEGER,
                    gender TEXT,
                    height_cm REAL,
                    current_weight_kg REAL,
                    target_weight_kg REAL,
                    
                    -- Preferences
                    dietary_restrictions TEXT,
                    activity_level TEXT,
                    goal_type TEXT,
                    
                    -- Progress tracking
                    weight_history TEXT,
                    notes TEXT
                )
            """)
            
            # Conversations table (optional - for future use)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    role TEXT,
                    content TEXT,
                    FOREIGN KEY (session_id) REFERENCES user_profiles(session_id)
                )
            """)
            
            logger.info(f"Database initialized at {self.db_path}")
    
    def create_or_update_profile(self, session_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create or update a user profile."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Check if profile exists
            cursor.execute("SELECT session_id FROM user_profiles WHERE session_id = ?", (session_id,))
            exists = cursor.fetchone() is not None
            
            # Serialize dietary_restrictions if it's a list
            dietary_restrictions = data.get('dietary_restrictions', [])
            if isinstance(dietary_restrictions, list):
                dietary_restrictions = json.dumps(dietary_restrictions)
            
            if exists:
                # Update existing profile
                cursor.execute("""
                    UPDATE user_profiles
                    SET last_active = CURRENT_TIMESTAMP,
                        age = ?,
                        gender = ?,
                        height_cm = ?,
                        current_weight_kg = ?,
                        target_weight_kg = ?,
                        dietary_restrictions = ?,
                        activity_level = ?,
                        goal_type = ?,
                        notes = ?
                    WHERE session_id = ?
                """, (
                    data.get('age'),
                    data.get('gender'),
                    data.get('height_cm'),
                    data.get('current_weight_kg'),
                    data.get('target_weight_kg'),
                    dietary_restrictions,
                    data.get('activity_level'),
                    data.get('goal_type'),
                    data.get('notes'),
                    session_id
                ))
                logger.info(f"Updated profile for session {session_id}")
            else:
                # Create new profile
                cursor.execute("""
                    INSERT INTO user_profiles (
                        session_id, age, gender, height_cm, current_weight_kg,
                        target_weight_kg, dietary_restrictions, activity_level,
                        goal_type, weight_history, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    session_id,
                    data.get('age'),
                    data.get('gender'),
                    data.get('height_cm'),
                    data.get('current_weight_kg'),
                    data.get('target_weight_kg'),
                    dietary_restrictions,
                    data.get('activity_level'),
                    data.get('goal_type'),
                    json.dumps([]),  # Empty weight history
                    data.get('notes')
                ))
                logger.info(f"Created new profile for session {session_id}")
            
            return self.get_profile(session_id)
    
    def get_profile(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a user profile."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM user_profiles WHERE session_id = ?", (session_id,))
            row = cursor.fetchone()
            
            if row:
                profile = dict(row)
                # Deserialize JSON fields
                if profile.get('dietary_restrictions'):
                    try:
                        profile['dietary_restrictions'] = json.loads(profile['dietary_restrictions'])
                    except:
                        profile['dietary_restrictions'] = []
                if profile.get('weight_history'):
                    try:
                        profile['weight_history'] = json.loads(profile['weight_history'])
                    except:
                        profile['weight_history'] = []
                return profile
            return None
    
    def log_weight(self, session_id: str, weight_kg: float) -> bool:
        """Log a weight entry for progress tracking."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Get current weight history
            cursor.execute("SELECT weight_history FROM user_profiles WHERE session_id = ?", (session_id,))
            row = cursor.fetchone()
            
            if not row:
                logger.warning(f"No profile found for session {session_id}")
                return False
            
            # Parse weight history
            try:
                weight_history = json.loads(row['weight_history']) if row['weight_history'] else []
            except:
                weight_history = []
            
            # Add new entry
            weight_history.append({
                'date': datetime.now().isoformat(),
                'weight_kg': weight_kg
            })
            
            # Update profile
            cursor.execute("""
                UPDATE user_profiles
                SET weight_history = ?,
                    current_weight_kg = ?,
                    last_active = CURRENT_TIMESTAMP
                WHERE session_id = ?
            """, (json.dumps(weight_history), weight_kg, session_id))
            
            logger.info(f"Logged weight {weight_kg}kg for session {session_id}")
            return True
    
    def get_progress(self, session_id: str, days: int = 30) -> Dict[str, Any]:
        """Get progress data for charts and analytics."""
        profile = self.get_profile(session_id)
        
        if not profile:
            return {'error': 'Profile not found'}
        
        weight_history = profile.get('weight_history', [])
        
        # Calculate BMI if we have height and current weight
        bmi = None
        if profile.get('height_cm') and profile.get('current_weight_kg'):
            height_m = profile['height_cm'] / 100
            bmi = round(profile['current_weight_kg'] / (height_m ** 2), 1)
        
        # Calculate progress
        progress_kg = None
        progress_percent = None
        if profile.get('current_weight_kg') and profile.get('target_weight_kg'):
            if weight_history:
                initial_weight = weight_history[0]['weight_kg']
                progress_kg = round(initial_weight - profile['current_weight_kg'], 1)
                total_to_lose = initial_weight - profile['target_weight_kg']
                if total_to_lose > 0:
                    progress_percent = round((progress_kg / total_to_lose) * 100, 1)
        
        return {
            'session_id': session_id,
            'current_weight_kg': profile.get('current_weight_kg'),
            'target_weight_kg': profile.get('target_weight_kg'),
            'bmi': bmi,
            'progress_kg': progress_kg,
            'progress_percent': progress_percent,
            'weight_history': weight_history[-days:] if weight_history else [],
            'total_entries': len(weight_history)
        }
    
    def ensure_session_exists(self, session_id: str) -> None:
        """Create an empty profile row if one doesn't exist yet."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM user_profiles WHERE session_id = ?", (session_id,))
            if cursor.fetchone() is None:
                cursor.execute("""
                    INSERT INTO user_profiles (session_id, weight_history)
                    VALUES (?, ?)
                """, (session_id, json.dumps([])))
                logger.info("Auto-created empty profile for session %s", session_id)
    
    def add_conversation_message(self, session_id: str, role: str, content: str) -> bool:
        """Add a message to conversation history."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Ensure the session row exists so the FK and last_active update work
            self.ensure_session_exists(session_id)
            
            cursor.execute("""
                INSERT INTO conversations (session_id, role, content)
                VALUES (?, ?, ?)
            """, (session_id, role, content))
            
            # Update last_active timestamp
            cursor.execute("""
                UPDATE user_profiles 
                SET last_active = CURRENT_TIMESTAMP 
                WHERE session_id = ?
            """, (session_id,))
            
            return True
    
    def get_conversation_history(self, session_id: str, limit: int = 30) -> List[Dict[str, str]]:
        """Get recent conversation history for a session."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT role, content, timestamp
                FROM conversations
                WHERE session_id = ?
                ORDER BY timestamp DESC
                LIMIT ?
            """, (session_id, limit))
            
            rows = cursor.fetchall()
            
            # Reverse to get chronological order (oldest first)
            messages = []
            for row in reversed(rows):
                messages.append({
                    'role': row['role'],
                    'content': row['content']
                })
            
            return messages
    
    def clear_conversation_history(self, session_id: str) -> bool:
        """Clear conversation history for a session (keep profile)."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM conversations WHERE session_id = ?", (session_id,))
            logger.info(f"Cleared conversation history for session {session_id}")
            return True
    
    def delete_profile(self, session_id: str) -> bool:
        """Delete a user profile (for privacy/GDPR compliance)."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM user_profiles WHERE session_id = ?", (session_id,))
            cursor.execute("DELETE FROM conversations WHERE session_id = ?", (session_id,))
            logger.info(f"Deleted profile for session {session_id}")
            return True


# Global database instance
_db_instance = None


def get_db() -> ProfileDB:
    """Get or create the global database instance."""
    global _db_instance
    if _db_instance is None:
        _db_instance = ProfileDB()
    return _db_instance

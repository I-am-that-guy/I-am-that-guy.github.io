from flaskblog import get_db_connection

def create_posts_table():
    connection = get_db_connection()
    cursor = connection.cursor()

    # Define your table schema
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS posts (
            id SERIAL PRIMARY KEY,
            title TEXT,
            content TEXT NOT NULL,
            media VARCHAR(200),
            date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    connection.commit()
    cursor.close()
    connection.close()


def create_documents_table():
    """Key/value store for site-wide uploaded documents (e.g. the LinkedIn
    profile PDF). One row per doc_key - re-uploading replaces the file record."""
    connection = get_db_connection()
    cursor = connection.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            doc_key VARCHAR(64) PRIMARY KEY,
            filename VARCHAR(255) NOT NULL,
            date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    connection.commit()
    cursor.close()
    connection.close()

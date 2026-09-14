from flask_wtf import FlaskForm
from wtforms import StringField, SubmitField
from flask_wtf.file import FileField, FileAllowed
from wtforms.validators import DataRequired
from flask_ckeditor import CKEditorField


class PostForm(FlaskForm):
    title = StringField('Title')
    content = CKEditorField('Content', validators=[DataRequired()])
    media = FileField('Upload media', validators=[FileAllowed(['jpg', 'jpeg', 'png'])])
    submit = SubmitField('Upload')


class LinkedInForm(FlaskForm):
    linkedin_pdf = FileField(
        'LinkedIn page (PDF)',
        validators=[FileAllowed(['pdf'], message='PDF files only!')]
    )
    submit = SubmitField('Upload LinkedIn PDF')

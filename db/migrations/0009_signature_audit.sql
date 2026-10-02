-- A signature is a legally meaningful act, so it is audited like any other.
CREATE TRIGGER audit_project_signatures
  AFTER INSERT OR UPDATE OR DELETE ON project_signatures
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('signature_id');

import { Component } from "react";
import { withTranslation } from "react-i18next";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary: ${this.props.name}]`, error, info.componentStack);
  }

  render() {
    const { t } = this.props;
    if (this.state.error) {
      return (
        <div className="error-boundary-fallback">
          <span className="error-boundary-fallback__title">
            {t("errorBoundary.crashed", "{{name}} crashed", { name: this.props.name })}
          </span>
          <span className="error-boundary-fallback__message">
            {this.state.error.message}
          </span>
          <button
            className="settings-footer-button settings-create-button"
            style={{ marginTop: "8px" }}
            onClick={() => this.setState({ error: null })}
          >
            {t("errorBoundary.reload", "Reload panel")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const TranslatedErrorBoundary = withTranslation("common")(ErrorBoundary);

export default TranslatedErrorBoundary;
